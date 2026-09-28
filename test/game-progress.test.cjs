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
  vm.runInNewContext(compile(readFileSync("src/game/Game.ts", "utf8")), {
    module, exports: module.exports, console, requestAnimationFrame() {},
    require(name) {
      if (name === "../progress/ProgressStore") return { ProgressStore: class { constructor() { return store; } } };
      if (name === "./GameScene") return { GameScene: class { loadBlocks() {} updateBlocks() {} setHudState() {} } };
      if (name === "./InputController") return { InputController: class {} };
      return require("../src/game/" + name);
    }
  });
  const game = new module.exports.Game({}, ui);
  return { game, ui, store };
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
