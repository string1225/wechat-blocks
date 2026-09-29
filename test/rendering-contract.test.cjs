const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sceneSource = readFileSync(path.resolve(__dirname, "..", "src", "game", "GameScene.ts"), "utf8");

test("renderer uses the platform pixel ratio for crisp mobile lines", () => {
  assert.match(sceneSource, /getDevicePixelRatio/);
  assert.equal(sceneSource.includes("globalThis.devicePixelRatio || 1"), false);
});

test("scene hud renders as an overlay without clearing the main scene", () => {
  assert.match(sceneSource, /this\.renderer\.autoClear = false;/);
  assert.match(sceneSource, /this\.renderer\.clear\(\);/);
  assert.match(sceneSource, /this\.renderer\.clearDepth\(\);/);
});
