const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function setup() {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/game/InputController.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, { module, exports: module.exports, require: () => ({ now: () => 100 }) });
  const events = new Map(), taps = [], rotations = [], zooms = [];
  const input = new module.exports.InputController({
    addEventListener: (name, handler) => events.set(name, handler),
    removeEventListener: name => events.delete(name)
  }, { onTap: (...p) => taps.push(p), onRotate: (...p) => rotations.push(p), onZoom: s => zooms.push(s) });
  const send = (name, id, x, y = 20) => events.get(name)?.({ pointerId: id, clientX: x, clientY: y });
  return { input, events, taps, rotations, zooms, send };
}

test("successive taps remain independent and small finger jitter does not rotate the board", () => {
  const { send, taps, rotations } = setup();
  for (let id = 1; id <= 3; id++) {
    send("pointerdown", id, 20); send("pointermove", id, 22); send("pointerup", id, 22);
  }
  assert.equal(taps.length, 3);
  assert.equal(rotations.length, 0);
});

test("a drag returning to its starting point and a cancelled touch never activate a block", () => {
  const { send, taps, rotations } = setup();
  send("pointerdown", 1, 20); send("pointermove", 1, 60);
  send("pointermove", 1, 20); send("pointerup", 1, 20);
  send("pointerdown", 2, 20); send("pointercancel", 2, 20); send("pointerup", 2, 20);
  assert.equal(taps.length, 0);
  assert.ok(rotations.length > 0);
});

test("lifting both fingers after a pinch does not tap, and the next single tap works", () => {
  const { input, events, send, taps, zooms } = setup();
  send("pointerdown", 1, 20); send("pointerdown", 2, 60);
  send("pointermove", 2, 80); send("pointerup", 2, 80); send("pointerup", 1, 20);
  assert.equal(taps.length, 0);
  assert.ok(zooms[0] < 1);
  send("pointerdown", 3, 20); send("pointerup", 3, 20);
  assert.equal(taps.length, 1);
  input.dispose(); assert.equal(events.size, 0);
});
