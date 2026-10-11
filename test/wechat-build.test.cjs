const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const webpack = require("webpack");
const { validateWechatBuild } = require("../scripts/wechat-validate-build.cjs");

test("WeChat build compiles modern syntax in TypeScript and dependencies and preserves original mappings", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-build-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/main.ts"), 'import { read } from "./vendor.js"; class Item { value = 7; } (globalThis as any).result = [new Item()?.value ?? 0, read()];');
  fs.writeFileSync(path.join(root, "src/vendor.js"), 'export const read = () => ({ value: 9 })?.value ?? 0;');
  fs.writeFileSync(path.join(root, "src/vendor.d.ts"), 'export function read(): number;');
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true }, include: ["src"] }));
  const config = require("../webpack.config.cjs")({ wechat: true }, { mode: "production" });
  config.mode = "production";
  config.context = root;
  config.entry = path.join(root, "src/main.ts");
  config.output.path = path.join(root, "output");
  config.plugins = [];
  for (const rule of config.module.rules) {
    for (const loader of rule.use || []) {
      if (loader.loader === "ts-loader") loader.options = { ...loader.options, configFile: path.join(root, "tsconfig.json") };
      if (loader.loader === "babel-loader") loader.options = { ...loader.options, cacheDirectory: false };
    }
  }
  config.resolveLoader = { modules: [path.resolve(__dirname, "../node_modules")] };
  const compiler = webpack(config);
  await new Promise((resolve, reject) => compiler.run((error, stats) => {
    compiler.close(closeError => {
      if (error || closeError) reject(error || closeError);
      else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    });
  }));
  validateWechatBuild(config.output.path);
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(config.output.path, "game.js"), "utf8"), context);
  assert.equal(JSON.stringify(context.result), "[7,9]");
  const map = JSON.parse(fs.readFileSync(path.join(config.output.path, "game.js.map"), "utf8"));
  assert.ok(map.sources.some(source => source.endsWith("src/main.ts")));
  assert.ok(map.sources.some(source => source.endsWith("src/vendor.js")));
});

test("pre-fortify validation rejects modern syntax and already protected inputs", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-build-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "game.js"), "var result = globalThis.data?.value;");
  assert.throws(() => validateWechatBuild(root), /Unexpected token/);
  fs.writeFileSync(path.join(root, "game.js"), "/* WXAG_OBF_PLUGIN_BY_test */ var result = 1;");
  assert.throws(() => validateWechatBuild(root), /must run before code fortify/);
});
