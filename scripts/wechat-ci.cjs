const fs = require("fs");
const path = require("path");
const { defaultSecretPath } = require("./wechat-fortify-key.cjs");
const { prepareProtectedProject, protectedSetting, validateFortifyConfig } = require("./wechat-fortify.cjs");

const rootDir = path.resolve(__dirname, "..");
const localConfigPath = path.join(rootDir, "wechat-ci.local.json");

const allowedCommands = new Set(["check", "fortify", "preview", "upload"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readLocalConfig() {
  if (!fs.existsSync(localConfigPath)) {
    return {};
  }

  return readJson(localConfigPath);
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : NaN;
}

function resolveFromRoot(value) {
  if (!value) {
    return "";
  }

  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function createConfig() {
  const packageJson = readJson(path.join(rootDir, "package.json"));
  const projectConfig = readJson(path.join(rootDir, "project.config.json"));
  const localConfig = readLocalConfig();

  const privateKeyPath = resolveFromRoot(
    process.env.WECHAT_PRIVATE_KEY_PATH || localConfig.privateKeyPath
  );
  const qrcodeOutputDest = resolveFromRoot(
    process.env.WECHAT_QRCODE_OUTPUT ||
      localConfig.qrcodeOutputDest ||
      "dist/preview-qrcode.jpg"
  );

  return {
    rootDir,
    appid: process.env.WECHAT_APPID || localConfig.appid || projectConfig.appid,
    desc:
      process.env.WECHAT_CI_DESC ||
      localConfig.desc ||
      `CI ${packageJson.version}`,
    privateKeyPath,
    secretConfigPath: resolveFromRoot(process.env.WECHAT_FORTIFY_SECRET_CONFIG || localConfig.fortifySecretConfigPath || defaultSecretPath),
    protectConfigPath: path.join(rootDir, "code.fortify.config.json"),
    fortifyTimeoutMinutes: toInt(process.env.WECHAT_FORTIFY_TIMEOUT_MINUTES || localConfig.fortifyTimeoutMinutes, 30),
    fortifyProxy: process.env.WECHAT_FORTIFY_PROXY || localConfig.fortifyProxy || "",
    qrcodeOutputDest,
    robot: toInt(process.env.WECHAT_CI_ROBOT || localConfig.robot, 1),
    version:
      process.env.WECHAT_CI_VERSION || localConfig.version || packageJson.version
  };
}

function validateConfig(config, command) {
  if (!allowedCommands.has(command)) {
    throw new Error(
      `Unknown command "${command}". Use check, fortify, preview, or upload.`
    );
  }

  if (!config.appid || config.appid === "touristappid") {
    throw new Error("Missing real WeChat appid in project.config.json.");
  }

  if (!config.privateKeyPath) {
    throw new Error(
      "Missing private key path. Set WECHAT_PRIVATE_KEY_PATH or create wechat-ci.local.json."
    );
  }

  if (!fs.existsSync(config.privateKeyPath)) {
    throw new Error(`Private key file not found: ${config.privateKeyPath}`);
  }

  if (!Number.isInteger(config.robot) || config.robot < 1 || config.robot > 30) {
    throw new Error("WECHAT_CI_ROBOT must be an integer from 1 to 30.");
  }

  if (!config.version) {
    throw new Error("Missing upload version.");
  }

  validateFortifyConfig(config);
}

function createProject(config, projectDir, ci) {
  return new ci.Project({
    appid: config.appid,
    type: "miniGame",
    projectPath: projectDir,
    privateKeyPath: config.privateKeyPath,
    ignores: ["node_modules/**/*"]
  });
}

async function run(command = "check", { config = createConfig(), ci, protect, log = console.log } = {}) {
  validateConfig(config, command);

  log(`[wechat-ci] appid: ${config.appid}`);
  log(`[wechat-ci] robot: ${config.robot}`);
  log(`[wechat-ci] version: ${config.version}`);
  log(
    `[wechat-ci] private key: ${path.basename(config.privateKeyPath)}`
  );

  if (command === "check") {
    log("[wechat-ci] local upload/fortify configuration is ready; MP public-key registration is verified when protecting");
    return;
  }

  const release = await prepareProtectedProject(config, { protect, log });
  if (command === "fortify") return release;
  const client = ci || require("miniprogram-ci");
  const project = createProject(config, release.projectDir, client);
  const setting = { ...protectedSetting };

  if (command === "preview") {
    fs.mkdirSync(path.dirname(config.qrcodeOutputDest), { recursive: true });
    fs.rmSync(config.qrcodeOutputDest, { force: true });

    await client.preview({
      project,
      desc: config.desc,
      setting,
      robot: config.robot,
      qrcodeFormat: "image",
      qrcodeOutputDest: config.qrcodeOutputDest,
      onProgressUpdate: console.log
    });

    log(`[wechat-ci] preview qrcode: ${config.qrcodeOutputDest}`);
    return;
  }

  await client.upload({
    project,
    version: config.version,
    desc: config.desc,
    setting,
    robot: config.robot,
    onProgressUpdate: console.log
  });

  log("[wechat-ci] protected upload finished");
}

if (require.main === module) {
  run(process.argv[2] || "check").catch((error) => {
    console.error(`[wechat-ci] ${error.message}`);
    // The CI compiler can leave worker processes alive after an error.
    process.exit(1);
  });
}

module.exports = { createConfig, run };
