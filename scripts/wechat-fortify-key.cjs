const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const defaultSecretPath = path.join(os.homedir(), ".wechat-blocks", "fortify", "id_rsa.conf");

function readSecret(secretPath, appid) {
  if (!fs.existsSync(secretPath)) {
    throw new Error(`Missing fortify key: ${secretPath}. Run npm run wechat:fortify:keygen, then register public.pem in MP > 开发支持 > 研发工具箱 > 密钥管理.`);
  }
  const text = fs.readFileSync(secretPath, "utf8").replace(/^\uFEFF/, "");
  const match = /^\[appid\]\s*([^\r\n]+)\s*\[private_key\]\s*([\s\S]+)$/m.exec(text);
  if (!match || match[1].trim() !== appid) {
    throw new Error("Fortify key configuration must contain the current appid and a private_key section.");
  }
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(match[2].trim());
  } catch {
    throw new Error("Invalid RSA private key in fortify configuration.");
  }
  if (privateKey.asymmetricKeyType !== "rsa" || privateKey.asymmetricKeyDetails.modulusLength < 2048) {
    throw new Error("Fortify requires an RSA private key of at least 2048 bits.");
  }
  const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  return { publicKey, keyFingerprint: crypto.createHash("sha256").update(publicKey).digest("hex") };
}

function prepareKey(appid, secretPath = defaultSecretPath) {
  if (!/^wx[a-f\d]{16}$/i.test(appid || "")) throw new Error("Missing valid WeChat appid.");
  const publicPath = path.join(path.dirname(secretPath), "public.pem");
  if (!fs.existsSync(secretPath)) {
    const keys = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" }
    });
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, `[appid]\n${appid}\n[private_key]\n${keys.privateKey}`, { flag: "wx", mode: 0o600 });
  }
  const { publicKey } = readSecret(secretPath, appid);
  if (fs.existsSync(publicPath) && fs.readFileSync(publicPath, "utf8") !== publicKey) {
    throw new Error(`Public key mismatch: ${publicPath}. Existing keys were preserved.`);
  }
  if (!fs.existsSync(publicPath)) fs.writeFileSync(publicPath, publicKey, { flag: "wx", mode: 0o600 });
  return { secretPath, publicPath };
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const project = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf8"));
  const localPath = path.join(root, "wechat-ci.local.json");
  const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, "utf8")) : {};
  const secretPath = path.resolve(root, process.env.WECHAT_FORTIFY_SECRET_CONFIG || local.fortifySecretConfigPath || defaultSecretPath);
  try {
    const result = prepareKey(process.env.WECHAT_APPID || local.appid || project.appid, secretPath);
    console.log(`[wechat-fortify] private configuration: ${result.secretPath}`);
    console.log(`[wechat-fortify] register this public key in MP: ${result.publicPath}`);
  } catch (error) {
    console.error(`[wechat-fortify] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { defaultSecretPath, prepareKey, readSecret };
