const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { prepareProtectedProject } = require("../scripts/wechat-fortify.cjs");
const { prepareKey, readSecret } = require("../scripts/wechat-fortify-key.cjs");
const { run } = require("../scripts/wechat-ci.cjs");

const appid = "wxdd87cda01434e266";
const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});
const sourceMap = JSON.stringify({ version: 3, sources: ["webpack://game/./src/main.ts"], sourcesContent: ["export const value = 1;"], names: [], mappings: "AAAA" });

function fixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-fortify-test-"));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const input = path.join(rootDir, ".wechat-build");
  fs.mkdirSync(path.join(input, "assets"), { recursive: true });
  fs.writeFileSync(path.join(input, "game.js"), "globalThis.testGame = 1;");
  fs.writeFileSync(path.join(input, "game.js.map"), sourceMap);
  fs.writeFileSync(path.join(input, "game.json"), '{"deviceOrientation":"portrait"}');
  fs.writeFileSync(path.join(input, "assets", "avatar.png"), "asset bytes");
  fs.writeFileSync(path.join(rootDir, "project.config.json"), JSON.stringify({ appid, miniprogramRoot: "dist/", setting: { es6: true, minified: true } }));
  const config = {
    rootDir, appid, privateKeyPath: path.join(rootDir, "upload.key"),
    secretConfigPath: path.join(rootDir, "id_rsa.conf"),
    protectConfigPath: path.join(rootDir, "code.fortify.config.json"),
    fortifyTimeoutMinutes: 30, fortifyProxy: "", robot: 1, version: "0.1.0", desc: "test",
    qrcodeOutputDest: path.join(rootDir, "preview.jpg")
  };
  fs.writeFileSync(config.privateKeyPath, "upload fixture");
  fs.writeFileSync(config.secretConfigPath, `[appid]\n${appid}\n[private_key]\n${privateKey}`);
  fs.writeFileSync(config.protectConfigPath, JSON.stringify({
    watermark: { files: ["game.js"] }, obfuscation: { tasks: [{ level: 2, files: ["game.js"] }] }
  }));
  return config;
}

async function fakeProtect(_input, output) {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "game.js"), "/* WXAG_OBF_PLUGIN_BY_test */ globalThis.testGame = 1;");
  fs.writeFileSync(path.join(output, "game.js.map"), sourceMap);
  return true;
}

test("a failed protection request stops upload and removes a previous release package", async t => {
  const config = fixture(t);
  const previous = path.join(config.rootDir, ".wechat-release", "project");
  fs.mkdirSync(previous, { recursive: true });
  fs.writeFileSync(path.join(previous, "stale.js"), "old release");
  let published = false;
  const ci = { Project: class { constructor() { published = true; } }, upload: async () => { published = true; } };
  await assert.rejects(run("upload", { config, ci, protect: async () => false, log() {} }), /fortify failed/);
  assert.equal(published, false);
  assert.equal(fs.existsSync(previous), false);
});

test("a complete protected package retains assets and original-source maps and disables later JS transformations", async t => {
  const config = fixture(t);
  let upload;
  const ci = {
    Project: class { constructor(options) { this.options = options; } },
    upload: async options => { upload = options; }
  };
  await run("upload", { config, ci, protect: fakeProtect, log() {} });
  const projectRoot = upload.project.options.projectPath;
  const projectConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "project.config.json")));
  assert.equal(projectConfig.miniprogramRoot, "game/");
  assert.equal(projectConfig.setting.uploadWithSourceMap, true);
  assert.equal(projectConfig.setting.minified, false);
  assert.equal(upload.setting.es6, false);
  assert.equal(upload.setting.minifyJS, false);
  assert.equal(upload.setting.minify, false);
  assert.equal(upload.setting.codeProtect, false);
  assert.equal(fs.readFileSync(path.join(projectRoot, "game", "assets", "avatar.png"), "utf8"), "asset bytes");
  assert.match(fs.readFileSync(path.join(projectRoot, "game", "game.js"), "utf8"), /WXAG_OBF_PLUGIN_BY_/);
  assert.equal(fs.readFileSync(path.join(projectRoot, "game", "game.js.map"), "utf8"), sourceMap);
  assert.equal(fs.existsSync(path.join(projectRoot, "game", "id_rsa.conf")), false);
  assert.equal(fs.existsSync(path.join(projectRoot, "game", "game.js.bak")), false);
});

test("upload and preview reuse verified results, while source changes and cache corruption require new protection", async t => {
  const config = fixture(t);
  let calls = 0;
  const protect = async (...args) => { calls++; return fakeProtect(...args); };
  const options = { protect, log() {} };
  const first = await prepareProtectedProject(config, options);
  const second = await prepareProtectedProject(config, options);
  assert.equal(calls, 1);
  assert.equal(second.cached, true);
  assert.equal(first.cacheKey, second.cacheKey);
  fs.appendFileSync(path.join(config.rootDir, ".wechat-fortify-cache", first.cacheKey, "game.js"), "\n// tampered");
  await prepareProtectedProject(config, options);
  assert.equal(calls, 2);
  fs.appendFileSync(path.join(config.rootDir, ".wechat-build", "game.js"), "\n// new source");
  const changed = await prepareProtectedProject(config, options);
  assert.equal(calls, 3);
  assert.notEqual(changed.cacheKey, first.cacheKey);
});

test("a service reporting success cannot publish missing protection markers or broken source maps", async t => {
  const config = fixture(t);
  await assert.rejects(prepareProtectedProject(config, {
    log() {}, protect: async (input, output) => {
      fs.copyFileSync(path.join(input, "game.js"), path.join(output, "game.js"));
      fs.copyFileSync(path.join(input, "game.js.map"), path.join(output, "game.js.map"));
      return true;
    }
  }), /Missing fortify marker/);
  await assert.rejects(prepareProtectedProject(config, {
    log() {}, protect: async (...args) => {
      await fakeProtect(...args);
      fs.writeFileSync(path.join(args[1], "game.js.map"), '{"version":3,"sources":["game.js"],"mappings":"AAAA"}');
      return true;
    }
  }), /missing original TypeScript sources/);
  assert.equal(fs.existsSync(path.join(config.rootDir, ".wechat-release", "project")), false);
});

test("mismatched appid and secret or backup files in the build are rejected before sending code", async t => {
  const config = fixture(t);
  let requests = 0;
  const options = { log() {}, protect: async () => { requests++; return true; } };
  await assert.rejects(prepareProtectedProject({ ...config, appid: "wx0000000000000000" }, options), /current appid/);
  fs.writeFileSync(path.join(config.rootDir, ".wechat-build", "game.js.bak"), "raw backup");
  await assert.rejects(prepareProtectedProject(config, options), /unprotected backup/);
  assert.equal(requests, 0);
});

test("preview awaits protection and replaces an old QR only after a protected release is ready", async t => {
  const config = fixture(t);
  fs.writeFileSync(config.qrcodeOutputDest, "old QR");
  let protectionFinished = false;
  const ci = {
    Project: class {},
    preview: async options => {
      assert.equal(protectionFinished, true);
      assert.equal(fs.existsSync(config.qrcodeOutputDest), false);
      fs.writeFileSync(options.qrcodeOutputDest, "fresh QR");
    }
  };
  await run("preview", { config, ci, log() {}, protect: async (...args) => {
    await fakeProtect(...args);
    protectionFinished = true;
    return true;
  } });
  assert.equal(fs.readFileSync(config.qrcodeOutputDest, "utf8"), "fresh QR");
});

test("key generation preserves an existing private key and exports its matching PEM public key", t => {
  const config = fixture(t);
  const original = fs.readFileSync(config.secretConfigPath, "utf8");
  const first = prepareKey(appid, config.secretConfigPath);
  const second = prepareKey(appid, config.secretConfigPath);
  assert.deepEqual(first, second);
  assert.equal(fs.readFileSync(config.secretConfigPath, "utf8"), original);
  assert.equal(fs.readFileSync(first.publicPath, "utf8"), readSecret(config.secretConfigPath, appid).publicKey);
});
