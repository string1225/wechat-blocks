const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sceneSource = readFileSync(path.resolve(__dirname, "..", "src", "game", "GameScene.ts"), "utf8");

test("default camera framing renders the cube at half the previous width fill", () => {
  assert.match(sceneSource, /const desiredWidthFill = 0\.35;/);
  assert.match(sceneSource, /const diagonalWidth = this\.activeSize \* BLOCK_SIZE \* 1\.38;/);
});

test("flight-direction faces stay blank without a gray fill overlay", () => {
  assert.equal(sceneSource.includes("blankFaceMaterial"), false);
  assert.equal(sceneSource.includes("blankFaceMesh"), false);
  assert.equal(sceneSource.includes("blankFaceOverlays"), false);
});
