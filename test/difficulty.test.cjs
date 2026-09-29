const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const test = require("node:test");
const ts = require("typescript");
require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(readFileSync(f, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, f);
const { getLevelConfig } = require("../src/data/levels.ts");
const { CubeGrid } = require("../src/world/CubeGrid.ts");
const { compactGrid, isGameProgress } = require("../src/progress/schema.ts");
const gradient = require("./fixtures/difficulty.json");

test("the published gradient grows one axis at a time and supports levels beyond ten", () => {
  for (const { level, x, y, z } of gradient) {
    const config = getLevelConfig(level);
    assert.deepEqual(config.dimensions, { x, y, z });
    assert.equal(config.maxMoves, x * y * z + 8);
    assert.equal(config.id, level);
  }
  for (let level = 2; level <= 1000; level++) {
    const before = getLevelConfig(level - 1).dimensions, after = getLevelConfig(level).dimensions;
    const differences = ["x", "y", "z"].map(axis => after[axis] - before[axis]);
    assert.ok(differences.every(n => n >= 0 && n <= 1));
    assert.ok(differences.reduce((a, b) => a + b) <= 1);
  }
});

test("rectangular and advanced boards are deterministic, valid saves and solvable without bombs", () => {
  for (const level of [1, 2, 3, 10, 11, 14, 22, 100, 101, 111, 121, 201]) {
    const config = getLevelConfig(level), grid = new CubeGrid(config);
    assert.equal(grid.activeCount, config.dimensions.x * config.dimensions.y * config.dimensions.z);
    assert.deepEqual(grid.snapshot(), new CubeGrid(config).snapshot());
    const progress = { version: 3, level, moves: 0, phase: "playing", blocks: compactGrid(grid.snapshot()),
      powerups: { bomb: 3, undo: 5 }, history: [] };
    assert.equal(isGameProgress(progress), true);
    const invalid = structuredClone(progress); invalid.blocks[0][2] = config.dimensions.y;
    assert.equal(isGameProgress(invalid), false, "shorter rectangular axis must be enforced");
    while (grid.activeCount) {
      const before = grid.activeCount;
      for (const block of grid.activeBlocks) {
        const direction = block.faceArrows[0].direction;
        if (grid.canExit(block, direction)) grid.beginFlight(block, direction);
      }
      grid.update(1);
      assert.ok(grid.activeCount < before, `level ${level} must not deadlock`);
    }
  }
});

test("legacy save templates retain exactly the same cells and arrows as the released version", () => {
  // SHA-256 of the pre-upgrade GridSnapshot, captured from e7ac52d.
  const golden = {
    1: "bad76f12bf843d486a45965d9ccb552a6d9a9af70cc1b586ab57aacc29c0d9f8",
    2: "724e7e4e89fd39702422d908e2ae4ad29182a49a369b78c3a7a3236eda1b235b",
    4: "3a20661027b102faf00daaa32b0c7c30ef640711b275c4f2f5eea9d7402cd9f6",
    7: "23c8dcbcdbfca54f66d06e1a608ecdcc78bded7f7e23b8fa152a6ac8682162e2",
    10: "f42500f05f535fd52117ab87bd11a0775d8fadadebd72316eeb73c8143f6c5c8"
  };
  for (const [level, expected] of Object.entries(golden)) {
    const grid = new CubeGrid(getLevelConfig(Number(level), 1));
    assert.equal(createHash("sha256").update(JSON.stringify(grid.snapshot())).digest("hex"), expected);
  }
});

test("version two retains its original dimensions while new games keep growing after 100", () => {
  for (const { level, x, y, z } of require("./fixtures/difficulty-v2.json"))
    assert.deepEqual(getLevelConfig(level, 2).dimensions, { x, y, z });
  for (let level = 101; level <= 1000; level += 10) {
    const before = getLevelConfig(level - 1).dimensions, after = getLevelConfig(level).dimensions;
    assert.equal(after.x + after.y + after.z - before.x - before.y - before.z, 1);
  }
});
