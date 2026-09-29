const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sceneSource = readFileSync(path.resolve(__dirname, "..", "src", "game", "GameScene.ts"), "utf8");

test("default camera framing renders the cube at half the previous width fill", () => {
  assert.match(sceneSource, /const desiredWidthFill = 0\.35;/);
  assert.match(sceneSource, /const diagonalWidth = this\.activeSize \* BLOCK_SIZE \* 1\.38;/);
});

test("renderer uses the platform pixel ratio for crisp mobile lines", () => {
  assert.match(sceneSource, /getDevicePixelRatio/);
  assert.equal(sceneSource.includes("globalThis.devicePixelRatio || 1"), false);
});

test("scene hud renders as an overlay without clearing the main scene", () => {
  assert.match(sceneSource, /this\.renderer\.autoClear = false;/);
  assert.match(sceneSource, /this\.renderer\.clear\(\);/);
  assert.match(sceneSource, /this\.renderer\.clearDepth\(\);/);
});
