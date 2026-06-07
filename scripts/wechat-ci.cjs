const fs = require("fs");
const path = require("path");
const ci = require("miniprogram-ci");

const rootDir = path.resolve(__dirname, "..");
const command = process.argv[2] || "check";
const localConfigPath = path.join(rootDir, "wechat-ci.local.json");

const allowedCommands = new Set(["check", "preview", "upload"]);

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
    appid: process.env.WECHAT_APPID || localConfig.appid || projectConfig.appid,
    desc:
      process.env.WECHAT_CI_DESC ||
      localConfig.desc ||
      `CI ${packageJson.version}`,
    privateKeyPath,
    qrcodeOutputDest,
    robot: toInt(process.env.WECHAT_CI_ROBOT || localConfig.robot, 1),
    version:
      process.env.WECHAT_CI_VERSION || localConfig.version || packageJson.version
  };
}

function validateConfig(config) {
  if (!allowedCommands.has(command)) {
    throw new Error(
      `Unknown command "${command}". Use check, preview, or upload.`
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
}

function createProject(config) {
  return new ci.Project({
    appid: config.appid,
    type: "miniGame",
    projectPath: rootDir,
    privateKeyPath: config.privateKeyPath,
    ignores: ["node_modules/**/*"]
  });
}

async function run() {
  const config = createConfig();
  validateConfig(config);

  console.log(`[wechat-ci] appid: ${config.appid}`);
  console.log(`[wechat-ci] robot: ${config.robot}`);
  console.log(`[wechat-ci] version: ${config.version}`);
  console.log(
    `[wechat-ci] private key: ${path.basename(config.privateKeyPath)}`
  );

  if (command === "check") {
    console.log("[wechat-ci] configuration is ready");
    return;
  }

  const project = createProject(config);
  const setting = {
    es6: true,
    minify: true,
    minifyJS: true
  };

  if (command === "preview") {
    fs.mkdirSync(path.dirname(config.qrcodeOutputDest), { recursive: true });

    await ci.preview({
      project,
      desc: config.desc,
      setting,
      robot: config.robot,
      qrcodeFormat: "image",
      qrcodeOutputDest: config.qrcodeOutputDest,
      onProgressUpdate: console.log
    });

    console.log(`[wechat-ci] preview qrcode: ${config.qrcodeOutputDest}`);
    return;
  }

  await ci.upload({
    project,
    version: config.version,
    desc: config.desc,
    setting,
    robot: config.robot,
    onProgressUpdate: console.log
  });

  console.log("[wechat-ci] upload finished");
}

run().catch((error) => {
  console.error(`[wechat-ci] ${error.message}`);
  process.exitCode = 1;
});
