const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, useDefineForClassFields: true }
}).outputText;
require.extensions[".ts"] = (module, filename) => module._compile(compile(readFileSync(filename, "utf8")), filename);
const { CubeGrid } = require("../src/world/CubeGrid.ts");
const { compactGrid } = require("../src/progress/schema.ts");
const { getLevelConfig } = require("../src/data/levels.ts");

function createGame(saved = null) {
  const store = { current: saved, saves: [], async connect() { return this.current; },
    save(p) { this.current = p; this.saves.push(p); } };
  const module = { exports: {} };
  const ui = { hideResult() {}, showToast() {}, update(s) { this.state = s; }, showResult(s) { this.result = s; } };
  let scene;
  vm.runInNewContext(compile(readFileSync("src/game/Game.ts", "utf8")), {
    module, exports: module.exports, console, requestAnimationFrame() {},
    require(name) {
      if (name === "../progress/ProgressStore") return { ProgressStore: class { constructor() { return store; } } };
      if (name === "./GameScene") return { GameScene: class {
        constructor() { scene = this; this.blocked = []; }
        loadBlocks() {} updateBlocks() {} setHudState(s) { this.state = s; }
        showBlocked(block) { this.blocked.push(block.instanceId); }
        pickHudAction() { return null; }
        pickBlock() { return this.pick; }
      } };
      if (name === "./InputController") return { InputController: class {} };
      return require("../src/game/" + name);
    }
  });
  const game = new module.exports.Game({}, ui);
  return { game, ui, store, scene };
}

test("game restores remaining blocks, tools and undo history after a move during animation", async () => {
  const first = createGame(); first.game.start(); await Promise.resolve();
  first.game.useBomb();
  const saved = first.store.current;
  assert.equal(saved.blocks.length, 63);
  assert.equal(saved.powerups.bomb, 2);
  assert.equal(saved.moves, 1);
  assert.equal(saved.history.length, 1);
  const second = createGame(saved); second.game.start(); await Promise.resolve();
  assert.equal(second.ui.state.remaining, 63);
  assert.equal(second.ui.state.canUndo, true);
  second.game.undo();
  assert.equal(second.store.current.blocks.length, 64);
  assert.equal(second.store.current.moves, 0);
  assert.equal(second.store.current.powerups.undo, 4);
  assert.equal(second.store.current.powerups.bomb, 2);
});

test("completed games resume at the next level and automatic play stays paused", async () => {
  const saved = { version: 1, level: 2, moves: 64, phase: "won", blocks: [], powerups: { undo: 1, bomb: 0 }, history: [] };
  const { game, ui, store } = createGame(saved); game.start(); await Promise.resolve();
  assert.equal(store.current.level, 3);
  assert.equal(store.current.phase, "playing");
  assert.equal(store.current.blocks.length, 64);
  assert.equal(ui.state.autoRunning, false);
});

test("switching difficulty and resetting immediately persist the selected game", async () => {
  const { game, store } = createGame(); game.start(); await Promise.resolve();
  game.loadLevel(7); game.useBomb();
  assert.equal(store.current.blocks.length, 124);
  game.resetLevel();
  assert.equal(store.current.level, 7);
  assert.equal(store.current.moves, 0);
  assert.equal(store.current.blocks.length, 125);
  assert.equal(JSON.stringify(store.current.blocks), JSON.stringify(compactGrid(new CubeGrid(getLevelConfig(7)).snapshot())));
});

function linearGame(positions) {
  const state = { version: 1, level: 1, moves: 0, phase: "playing", powerups: { undo: 5, bomb: 3 },
    blocks: positions.map((x, id) => [id, x, 0, 0]), history: [] };
  const fixture = createGame(state);
  for (const block of fixture.game.grid.blocks) for (const arrow of block.faceArrows) arrow.direction = { x: 1, y: 0, z: 0 };
  fixture.game.ready = true;
  return fixture;
}

test("rapid taps remove following blocks while the leading exit is still animating", () => {
  const { game, scene, store } = linearGame([2, 3]);
  scene.pick = { instanceId: 1, faceNormal: { x: 1, y: 0, z: 0 } };
  game.handleTap(1, 1);
  assert.equal(game.grid.isAnimating(), true);
  scene.pick = { instanceId: 0, faceNormal: { x: 1, y: 0, z: 0 } };
  game.handleTap(1, 1);
  assert.equal(game.moves, 2);
  assert.equal(store.current.blocks.length, 0);
  assert.equal(store.current.phase, "won");
  assert.equal(store.current.history[1].blocks.length, 1);
  game.undo();
  assert.equal(game.grid.activeCount, 1);
  assert.equal(game.moves, 1);
  game.undo();
  assert.equal(game.grid.activeCount, 2);
  assert.equal(game.moves, 0);
});

test("blocked clicks flash the selected block without charging moves, tools or saving a new turn", () => {
  const { game, scene, store } = linearGame([0, 1]);
  scene.pick = { instanceId: 0, faceNormal: { x: 1, y: 0, z: 0 } };
  game.handleTap(1, 1);
  assert.deepEqual(scene.blocked, [0]);
  assert.equal(game.moves, 0);
  assert.equal(game.history.length, 0);
  assert.equal(store.saves.length, 0);
  assert.equal(game.powerups.bomb, 3);
});

test("victory waits for all exiting blocks and exposes the next game through the canvas HUD", () => {
  const { game, scene, ui } = linearGame([2, 3]);
  game.flyBlock(game.grid.blocks[1], { x: 1, y: 0, z: 0 }, "Fly");
  game.grid.update(0.3);
  game.flyBlock(game.grid.blocks[0], { x: 1, y: 0, z: 0 }, "Fly");
  game.grid.update(0.2); game.checkProgress();
  assert.equal(game.phase, "playing");
  game.grid.update(0.3); game.checkProgress(); game.updateUi();
  assert.equal(ui.result.phase, "won");
  assert.equal(scene.state.phase, "won");
  game.handleHudAction("levelNext");
  assert.equal(game.level.id, 2);
  assert.equal(game.phase, "playing");
});
