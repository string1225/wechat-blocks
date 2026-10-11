const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readSecret } = require("./wechat-fortify-key.cjs");

const cliVersion = "0.1.8";
const marker = "WXAG_OBF_PLUGIN_BY_";
const protectedSetting = {
  es6: false,
  es7: false,
  minify: false,
  minifyJS: false,
  minifyWXML: false,
  minifyWXSS: false,
  codeProtect: false
};

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function clearGenerated(root, directory) {
  const resolved = path.resolve(directory);
  if (!inside(root, resolved) || resolved === path.resolve(root) ||
      ![".wechat-release", ".wechat-fortify-cache"].includes(path.relative(root, resolved).split(path.sep)[0])) {
    throw new Error(`Refusing to remove directory outside generated release paths: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function readProtection(config) {
  const protection = JSON.parse(fs.readFileSync(config.protectConfigPath, "utf8"));
  const files = new Set();
  const addFiles = (list) => {
    if (!Array.isArray(list)) throw new Error("Fortify files must be an array.");
    for (const file of list) {
      if (typeof file !== "string" || !file.endsWith(".js") || path.isAbsolute(file) ||
          file.includes("\\") || file.split("/").some(part => part === ".." || part === "")) {
        throw new Error("Fortify targets must be relative JS file paths inside the game build.");
      }
      files.add(file);
    }
  };
  if (protection.watermark) addFiles(protection.watermark.files);
  if (protection.obfuscation) {
    if (!Array.isArray(protection.obfuscation.tasks)) throw new Error("Missing obfuscation tasks.");
    for (const task of protection.obfuscation.tasks) {
      if (![1, 2, 3].includes(task.level)) throw new Error("Fortify level must be 1, 2, or 3.");
      addFiles(task.files);
    }
  }
  if (!files.has("game.js") || !protection.obfuscation?.tasks.some(task => task.files.includes("game.js"))) {
    throw new Error("The game.js entry must be obfuscated before publishing.");
  }
  return { protection, files: [...files].sort() };
}

function validateFortifyConfig(config) {
  if (!Number.isInteger(config.fortifyTimeoutMinutes) || config.fortifyTimeoutMinutes < 1) {
    throw new Error("Fortify timeout must be a positive integer in minutes.");
  }
  const inputDir = path.join(config.rootDir, ".wechat-build");
  const releaseDir = path.join(config.rootDir, ".wechat-release");
  if (inside(inputDir, config.secretConfigPath) || inside(releaseDir, config.secretConfigPath) ||
      inside(inputDir, config.privateKeyPath) || inside(releaseDir, config.privateKeyPath)) {
    throw new Error("Private keys must be stored outside build and release directories.");
  }
  const secret = readSecret(config.secretConfigPath, config.appid);
  return { ...readProtection(config), ...secret };
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifyArtifacts(directory, files, expectedHashes) {
  const hashes = {};
  for (const file of files) {
    const jsPath = path.join(directory, file);
    const mapPath = `${jsPath}.map`;
    if (!fs.existsSync(jsPath) || !fs.existsSync(mapPath)) throw new Error(`Missing protected artifact: ${file} / ${file}.map`);
    const code = fs.readFileSync(jsPath, "utf8");
    if (!code.includes(marker)) throw new Error(`Missing fortify marker in ${file}; refusing to publish unprotected code.`);
    new vm.Script(code, { filename: file });
    const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    if (map.version !== 3 || !Array.isArray(map.sources) || map.sources.length === 0 || !map.mappings ||
        !map.sources.some(source => /(^|\/)src\/.*\.ts$/.test(source))) {
      throw new Error(`Invalid fortify sourcemap or missing original TypeScript sources: ${file}.map`);
    }
    hashes[file] = digest(jsPath);
    hashes[`${file}.map`] = digest(mapPath);
    if (expectedHashes && (expectedHashes[file] !== hashes[file] || expectedHashes[`${file}.map`] !== hashes[`${file}.map`])) {
      throw new Error(`Protected cache integrity check failed: ${file}`);
    }
  }
  return hashes;
}

function rejectSensitiveFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Release files must not contain symbolic links.");
    if (entry.isDirectory()) rejectSensitiveFiles(target);
    else if (/\.(?:bak|pem|key|conf)$/i.test(entry.name) || entry.name === "code.fortify.config.json") {
      throw new Error(`Sensitive or unprotected backup file in game build: ${entry.name}`);
    }
  }
}

async function prepareProtectedProject(config, { protect, log = console.log } = {}) {
  const root = config.rootDir;
  const inputDir = path.join(root, ".wechat-build");
  const projectDir = path.join(root, ".wechat-release", "project");
  // Remove a previous package before validating so failures cannot leave a publishable stale package.
  clearGenerated(root, projectDir);
  const { protection, files, keyFingerprint } = validateFortifyConfig(config);
  if (!fs.existsSync(path.join(inputDir, "game.json"))) throw new Error("Missing WeChat build. Run npm run build:wechat first.");
  rejectSensitiveFiles(inputDir);
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ appid: config.appid, cliVersion, keyFingerprint, protection }));
  for (const file of files) {
    const input = path.join(inputDir, file);
    if (!fs.existsSync(input) || !fs.existsSync(`${input}.map`)) throw new Error(`Missing source JS/map: ${file}`);
    if (fs.readFileSync(input, "utf8").includes(marker)) throw new Error(`Input is already protected: ${file}`);
    fingerprint.update(file).update(fs.readFileSync(input)).update(fs.readFileSync(`${input}.map`));
  }
  const cacheKey = fingerprint.digest("hex");
  const cacheDir = path.join(root, ".wechat-fortify-cache", cacheKey);
  const manifestPath = path.join(cacheDir, "manifest.json");
  let cached = false;
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.cacheKey !== cacheKey) throw new Error("Cache key mismatch.");
      verifyArtifacts(cacheDir, files, manifest.hashes);
      cached = true;
      log("[wechat-fortify] reusing verified protected JS/maps");
    } catch {
      log("[wechat-fortify] invalid cache; requesting protection again");
    }
  }
  if (!cached) {
    clearGenerated(root, cacheDir);
    fs.mkdirSync(cacheDir, { recursive: true });
    const protectApi = protect || require("minigame-code-fortify-cli").protect;
    log(`[wechat-fortify] protecting ${files.join(", ")} (CLI ${cliVersion})`);
    try {
      const ok = await protectApi(inputDir, cacheDir, {
        secretConfigPath: config.secretConfigPath,
        protectConfigPath: config.protectConfigPath,
        networkOptions: { timeout_minute: config.fortifyTimeoutMinutes, ...(config.fortifyProxy ? { proxy: config.fortifyProxy } : {}) }
      });
      if (ok !== true) throw new Error("WeChat code fortify failed. Upload/preview stopped; see CLI output above (including MP public-key registration errors).");
      const hashes = verifyArtifacts(cacheDir, files);
      fs.writeFileSync(manifestPath, JSON.stringify({ cacheKey, appid: config.appid, cliVersion, hashes }, null, 2));
    } catch (error) {
      clearGenerated(root, cacheDir);
      throw error;
    }
  }
  const gameDir = path.join(projectDir, "game");
  try {
    fs.cpSync(inputDir, gameDir, { recursive: true });
    for (const file of files) {
      fs.copyFileSync(path.join(cacheDir, file), path.join(gameDir, file));
      fs.copyFileSync(path.join(cacheDir, `${file}.map`), path.join(gameDir, `${file}.map`));
    }
    verifyArtifacts(gameDir, files);
    const projectConfig = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf8"));
    projectConfig.appid = config.appid;
    projectConfig.miniprogramRoot = "game/";
    projectConfig.setting = { ...projectConfig.setting, ...protectedSetting, minified: false, enhance: false, swc: false, disableSWC: true, uploadWithSourceMap: true };
    fs.writeFileSync(path.join(projectDir, "project.config.json"), JSON.stringify(projectConfig, null, 2));
    rejectSensitiveFiles(gameDir);
    log(`[wechat-fortify] verified release: ${projectDir}`);
    return { projectDir, gameDir, cacheKey, cached, files };
  } catch (error) {
    clearGenerated(root, projectDir);
    throw error;
  }
}

module.exports = { prepareProtectedProject, protectedSetting, validateFortifyConfig };
