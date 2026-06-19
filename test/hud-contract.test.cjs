const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const indexSource = readFileSync(path.join(projectRoot, "src", "index.html"), "utf8");
const browserHudSource = readFileSync(path.join(projectRoot, "src", "ui", "BrowserHud.ts"), "utf8");

test("top hud uses a compact difficulty stepper instead of a level list", () => {
  assert.match(indexSource, /id="hud-difficulty"/);
  assert.match(indexSource, /id="hud-difficulty-prev"/);
  assert.match(indexSource, /id="hud-difficulty-next"/);

  assert.equal(indexSource.includes('id="hud-level"'), false);
  assert.equal(indexSource.includes('id="level-strip"'), false);
  assert.equal(indexSource.includes("level-button"), false);
  assert.equal(indexSource.includes("关卡"), false);
});

test("difficulty arrows load the previous and next difficulty", () => {
  assert.match(browserHudSource, /hud-difficulty-prev/);
  assert.match(browserHudSource, /hud-difficulty-next/);
  assert.match(browserHudSource, /onLevel\(this\.currentLevel - 1\)/);
  assert.match(browserHudSource, /onLevel\(this\.currentLevel \+ 1\)/);

  assert.equal(browserHudSource.includes("renderLevelButtons"), false);
  assert.equal(browserHudSource.includes("第 ${result.level} 关"), false);
});
