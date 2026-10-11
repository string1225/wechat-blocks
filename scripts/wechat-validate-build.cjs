const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");

function validateWechatBuild(directory) {
  const jsPath = path.join(directory, "game.js");
  const code = fs.readFileSync(jsPath, "utf8");
  if (code.includes("WXAG_OBF_PLUGIN_BY_")) throw new Error("Compatibility compilation must run before code fortify.");
  acorn.parse(code, { ecmaVersion: 5, sourceType: "script" });
  const map = JSON.parse(fs.readFileSync(`${jsPath}.map`, "utf8"));
  if (map.version !== 3 || !map.sources.some(source => /src\/.*\.ts$/.test(source)) || !map.mappings) {
    throw new Error("Missing original TypeScript mappings in the WeChat build.");
  }
}

if (require.main === module) {
  try {
    validateWechatBuild(path.resolve(__dirname, "..", ".wechat-build"));
    console.log("[wechat-build] JS passes ES5 syntax validation before protection");
  } catch (error) {
    console.error(`[wechat-build] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { validateWechatBuild };
