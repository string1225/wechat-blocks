const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, useDefineForClassFields: true }
}).outputText, filename);
const { ProgressStore } = require("../src/progress/ProgressStore.ts");
const { compactGrid, expandGrid, isGameProgress } = require("../src/progress/schema.ts");
const { CubeGrid } = require("../src/world/CubeGrid.ts");
const { getLevelConfig } = require("../src/data/levels.ts");

function sample(level = 1) {
  return { version: 3, level, moves: 0, phase: "playing", powerups: { undo: 5, bomb: 3 },
    blocks: compactGrid(new CubeGrid(getLevelConfig(level)).snapshot()), history: [] };
}
function platform(initial = null) {
  let serialized = initial && JSON.stringify(initial);
  const remote = { revision: 0, progress: null, mutation: null };
  const token = "a".repeat(64), player = "b".repeat(64);
  return {
    remote, token, player, lostResponse: false, offline: false, backups: [], calls: [],
    read: () => serialized, write: (value) => { serialized = value; },
    backup(value) { this.backups.push(value); }, onResume() {}, onHide() {},
    async request(path, method, _token, data) {
      this.calls.push({ path, method, data });
      if (this.offline) throw new Error("offline");
      if (path === "/session/guest") return { status: 200, data: { token, player } };
      if (method === "GET") return { status: 200, data: structuredClone(remote) };
      if (data.mutation === remote.mutation) return { status: 200, data: { revision: remote.revision } };
      if (data.revision !== remote.revision) return { status: 409, data: structuredClone(remote) };
      remote.revision++; remote.mutation = data.mutation; remote.progress = structuredClone(data.progress);
      if (this.lostResponse) { this.lostResponse = false; throw new Error("response lost"); }
      return { status: 200, data: { revision: remote.revision } };
    }
  };
}

test("a flight is saved at its destination even if the game exits before animation completes", () => {
  const grid = new CubeGrid(getLevelConfig(1));
  const block = grid.activeBlocks.find(b => b.faceArrows.some(a => grid.canExit(b, a.direction)));
  const direction = block.faceArrows.find(a => grid.canExit(block, a.direction)).direction;
  grid.beginFlight(block, direction);
  const settled = compactGrid(grid.settledSnapshot());
  assert.equal(settled.length, 63);
  assert.equal(grid.activeCount, 64);
  const restored = new CubeGrid(getLevelConfig(1));
  restored.restore(expandGrid(settled, restored.snapshot()));
  assert.equal(restored.activeCount, 63);
  assert.equal(restored.isAnimating(), false);
});

test("compact saves round trip the exact board and reject corrupt or overlapping blocks", () => {
  const p = sample(10);
  assert.equal(isGameProgress(p), true);
  const grid = new CubeGrid(getLevelConfig(10));
  assert.deepEqual(compactGrid(expandGrid(p.blocks, grid.snapshot())), p.blocks);
  p.blocks[1] = [...p.blocks[0]];
  assert.equal(isGameProgress(p), false);
  assert.equal(isGameProgress({ ...sample(), phase: "won" }), false);
  assert.equal(isGameProgress({ ...sample(), moves: NaN }), false);
});

test("saves synchronously locally and restores exact progress after reopening", async t => {
  const io = platform(), store = new ProgressStore(io); t.after(() => store.dispose());
  await store.connect(() => {});
  const p = sample(4); p.moves = 1; p.blocks.pop(); p.powerups.bomb = 2;
  store.save(p);
  assert.deepEqual(JSON.parse(io.read()).progress, p);
  await store.flush();
  const reopened = new ProgressStore(io); t.after(() => reopened.dispose());
  assert.deepEqual(await reopened.connect(() => {}), p);
  assert.equal(io.remote.revision, 1);
});

test("offline progress survives reopening and retries when connectivity returns", async t => {
  const io = platform(), first = new ProgressStore(io); t.after(() => first.dispose());
  await first.connect(() => {}); io.offline = true;
  const p = sample(5); first.save(p); await first.flush(); first.dispose();
  const second = new ProgressStore(io); t.after(() => second.dispose());
  assert.deepEqual(await second.connect(() => {}), p);
  io.offline = false; await second.flush();
  assert.deepEqual(io.remote.progress, p);
  assert.equal(JSON.parse(io.read()).mutation, null);
});

test("an acknowledged-late write is retried idempotently after a lost response", async t => {
  const io = platform(), store = new ProgressStore(io); t.after(() => store.dispose());
  await store.connect(() => {}); io.lostResponse = true;
  store.save(sample()); await store.flush();
  assert.equal(io.remote.revision, 1);
  await store.flush();
  assert.equal(io.remote.revision, 1);
  assert.equal(JSON.parse(io.read()).mutation, null);
});

test("a stale device preserves its conflict backup and does not overwrite a newer cloud save", async t => {
  const io = platform(), store = new ProgressStore(io); t.after(() => store.dispose());
  let restored;
  await store.connect(p => { restored = p; });
  io.remote.revision = 2; io.remote.progress = sample(3);
  store.save(sample(2)); await store.flush();
  assert.equal(io.remote.progress.level, 3);
  assert.equal(restored.level, 3);
  assert.equal(JSON.parse(io.backups[0]).progress.level, 2);
});

test("writes that arrive during a request are serialized after it without losing the newest move", async t => {
  const io = platform(), store = new ProgressStore(io); t.after(() => store.dispose());
  await store.connect(() => {});
  const request = io.request.bind(io);
  let release;
  io.request = async (...args) => {
    if (args[1] === "PUT" && !release) await new Promise(resolve => { release = resolve; });
    return request(...args);
  };
  store.save(sample(1)); const pending = store.flush();
  store.save(sample(2)); release(); await pending;
  assert.equal(io.remote.progress.level, 2);
  assert.equal(io.remote.revision, 2);
});

test("WeChat always checks the account on reopening and never mixes two accounts", async t => {
  const previous = { version: 1, token: "a".repeat(64), player: "b".repeat(64), kind: "wechat",
    revision: 5, progress: sample(5), mutation: "pending-move" };
  const io = platform(previous); io.login = async () => "new-account-code";
  const request = io.request.bind(io);
  io.request = (path, ...args) => path === "/session/wechat"
    ? Promise.resolve({ status: 200, data: { token: "c".repeat(64), player: "d".repeat(64), revision: 0, progress: null } })
    : request(path, ...args);
  const store = new ProgressStore(io); t.after(() => store.dispose());
  assert.equal(await store.connect(() => {}), null);
  assert.equal(io.remote.progress, null);
  assert.equal(io.backups.length, 1);
});

test("a lost response with newer local moves retries the original write then saves the newer moves", async t => {
  const io = platform(), first = new ProgressStore(io); t.after(() => first.dispose());
  await first.connect(() => {});
  const request = io.request.bind(io);
  let release;
  io.request = async (...args) => {
    if (args[1] === "PUT" && !release) await new Promise(resolve => { release = resolve; });
    return request(...args);
  };
  io.lostResponse = true;
  first.save(sample(1)); const pending = first.flush();
  first.save(sample(2)); release(); await pending; first.dispose();
  assert.equal(io.remote.progress.level, 1);
  const second = new ProgressStore(io); t.after(() => second.dispose());
  await second.connect(() => {});
  assert.equal(io.remote.progress.level, 2);
  assert.equal(io.remote.revision, 2);
  assert.equal(io.backups.length, 0);
});

test("large level saves use a normal request instead of the browser's 64 KiB keepalive quota", async () => {
  const { createProgressPlatform } = require("../src/progress/platform.ts");
  const p = sample(10);
  p.moves = 30;
  p.history = Array.from({ length: 30 }, (_, moves) => ({ moves, blocks: p.blocks }));
  assert.equal(isGameProgress(p), true);
  const original = global.fetch;
  let options;
  global.fetch = async (_url, input) => { options = input; return { status: 200, json: async () => ({ revision: 1 }) }; };
  try {
    await createProgressPlatform().request("/progress", "PUT", "a".repeat(64), { progress: p });
    assert.ok(options.body.length > 65536);
    assert.equal(options.keepalive, false);
  } finally { global.fetch = original; }
});

test("elapsed time is optional for old saves and invalid timer values are rejected", () => {
  const p = sample();
  assert.equal(isGameProgress(p), true);
  assert.equal(isGameProgress({ ...p, elapsedMs: 61023 }), true);
  for (const elapsedMs of [-1, 0.5, NaN, Infinity, "100", null, true, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(isGameProgress({ ...p, elapsedMs }), false);
});

test("timer formatting supports minutes and games lasting more than an hour", () => {
  const { formatTime } = require("../src/ui/formatTime.ts");
  assert.equal(formatTime(0), "00:00"); assert.equal(formatTime(61), "01:01");
  assert.equal(formatTime(3600), "1:00:00"); assert.equal(formatTime(3661), "1:01:01");
});
