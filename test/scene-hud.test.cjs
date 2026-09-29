const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const THREE = require("three");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, useDefineForClassFields: true
} }).outputText;
require.extensions[".ts"] = (module, filename) => module._compile(compile(readFileSync(filename, "utf8")), filename);
const { SceneHud, layoutSceneHud } = require("../src/ui/SceneHud.ts");
const { CubeGrid, BLOCK_SIZE } = require("../src/world/CubeGrid.ts");
const { getLevelConfig } = require("../src/data/levels.ts");
const { createTextureCanvas } = require("../src/platform/canvas.ts");
const state = { autoRunning: false, canUndo: true, level: 1, bombArmed: false, bombTarget: null, maxMoves: 72,
  moves: 2, phase: "playing", powerups: { undo: 5, bomb: 3 }, remaining: 62, stars: 3 };
function canvas() {
  const context = new Proxy({}, { get: (target, name) => target[name] ?? (() => {}) });
  return { width: 0, height: 0, getContext: () => context };
}
function textureRuntime(t) {
  global.wx = { createCanvas: canvas, getSystemInfoSync: () => ({ windowWidth: 320, windowHeight: 640, pixelRatio: 2 }) };
  t.after(() => { delete global.wx; });
}

test("WeChat textures prefer the real canvas when a partial document shim exists", t => {
  textureRuntime(t);
  global.document = { createElement: () => { throw new Error("document shim must not be used"); } };
  t.after(() => { delete global.document; });
  const result = createTextureCanvas(20, 30);
  assert.equal(result.width, 20); assert.equal(result.height, 30);
});

test("mobile HUD triangles face the camera, are inside the clip range, and hit the visible buttons", t => {
  textureRuntime(t);
  for (const [width, height] of [[294, 640], [375, 812], [430, 932], [812, 375]]) {
    const hud = new SceneHud(); hud.update(width, height, state);
    hud.camera.updateMatrixWorld(); hud.scene.updateMatrixWorld(true);
    for (const mesh of hud.scene.children) {
      const points = Array.from(mesh.geometry.index.array.slice(0, 3), index =>
        new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index).applyMatrix4(mesh.matrixWorld).project(hud.camera));
      const [a, b, c] = points;
      assert.ok((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0, "HUD must not be back-face culled");
      assert.ok(points.every(p => p.z > -1 && p.z < 1), "HUD must be inside the near/far planes");
    }
    for (const element of layoutSceneHud(width, height, state)) {
      assert.ok(element.x >= 0 && element.x + element.width <= width);
      assert.ok(element.y >= 0 && element.y + element.height <= height);
      if (element.action && !element.disabled) assert.equal(hud.pick(element.x + element.width / 2, element.y + element.height / 2), element.action);
    }
  }
});

test("victory is a modal canvas panel with working next-level and replay buttons", t => {
  textureRuntime(t);
  const won = { ...state, phase: "won", remaining: 0 };
  const hud = new SceneHud(); hud.update(320, 640, won);
  const elements = layoutSceneHud(320, 640, won);
  assert.ok(elements.some(e => e.label === "过关了！"));
  const next = elements.find(e => e.label === "下一关");
  assert.equal(hud.pick(next.x + 10, next.y + 10), "levelNext");
  assert.equal(hud.pick(310, 100), "consume");
  assert.equal(layoutSceneHud(320, 640, { ...won, level: 1000 }).some(e => e.label === "下一关"), true);
});

function sceneFixture(t) {
  textureRuntime(t);
  const module = { exports: {} };
  class Renderer {
    capabilities = { getMaxAnisotropy: () => 8 };
    setPixelRatio() {} setSize() {} setClearColor() {} clear() {} clearDepth() {} render() {}
  }
  vm.runInNewContext(compile(readFileSync("src/game/GameScene.ts", "utf8")), {
    module, exports: module.exports, console,
    require(name) { return name === "three" ? { ...THREE, WebGLRenderer: Renderer } : require("../src/game/" + name); }
  });
  const scene = new module.exports.GameScene({ clientWidth: 320, clientHeight: 640 });
  const grid = new CubeGrid(getLevelConfig(1));
  scene.loadBlocks(grid.blocks, grid.dimensions);
  return { scene, grid };
}

test("arrows share the solid cube faces and the darker rear tracks every flight direction", t => {
  const { scene, grid } = sceneFixture(t);
  assert.equal(scene.mesh.geometry.type, "BoxGeometry");
  assert.equal(scene.mesh.material[0], scene.mesh.material[4]);
  assert.notEqual(scene.mesh.material[2], scene.mesh.material[3]);
  for (const material of scene.mesh.material) {
    assert.equal(material.side, THREE.FrontSide);
    assert.equal(material.depthWrite, true);
    assert.equal(material.transparent, false);
    assert.equal(material.polygonOffset, false);
  }
  const matrix = new THREE.Matrix4();
  for (const block of grid.blocks) {
    scene.mesh.getMatrixAt(block.instanceId, matrix);
    const forward = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
    const rear = new THREE.Vector3(0, -1, 0).transformDirection(matrix);
    const direction = block.faceArrows[0].direction;
    const expected = new THREE.Vector3(direction.x, direction.y, direction.z);
    assert.ok(forward.distanceTo(expected) < 1e-6);
    assert.ok(rear.distanceTo(expected.negate()) < 1e-6);
  }
  assert.ok(Array.from(scene.mesh.geometry.attributes.position.array).every(v => Math.abs(v) <= BLOCK_SIZE / 2 + 1e-7));
});

test("blocked feedback flashes and shakes only the selected block then restores its original pose", t => {
  const { scene, grid } = sceneFixture(t);
  const block = grid.blocks[0], original = block.current.clone();
  const base = new THREE.Color(); scene.mesh.getColorAt(0, base);
  scene.showBlocked(block);
  const warning = new THREE.Color(); scene.mesh.getColorAt(0, warning);
  assert.notEqual(warning.getHex(), base.getHex());
  scene.render(0.06);
  const matrix = new THREE.Matrix4(); scene.mesh.getMatrixAt(0, matrix);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(original) > 0.001);
  assert.ok(block.current.equals(original));
  scene.render(0.5);
  scene.mesh.getColorAt(0, warning); scene.mesh.getMatrixAt(0, matrix);
  assert.equal(warning.getHex(), base.getHex());
  assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(original) < 1e-6);
});

test("camera crosses both poles smoothly and returns after a full vertical revolution", t => {
  const { scene } = sceneFixture(t);
  const start = scene.camera.position.clone(), orientation = scene.camera.quaternion.clone();
  for (let turn = 0; turn < 720; turn++) {
    const before = scene.camera.quaternion.clone();
    scene.rotate(0, Math.PI * 2 / 0.005 / 720);
    assert.ok(before.angleTo(scene.camera.quaternion) < 0.02, "no abrupt flip at either pole");
    assert.ok(scene.camera.position.toArray().every(Number.isFinite));
  }
  assert.ok(start.distanceTo(scene.camera.position) < 1e-6);
  assert.ok(orientation.angleTo(scene.camera.quaternion) < 1e-6);
  scene.rotate(0, Math.PI / 0.005);
  assert.ok(scene.camera.position.y < scene.target.y, "underside must be reachable");
  assert.equal(scene.stage.visible, false, "decorative floor cannot cover the underside");
});

test("bomb confirmation consumes background clicks and targets the confirm/cancel buttons", t => {
  textureRuntime(t);
  const selected = { ...state, bombArmed: true, bombTarget: { x: 1, y: 0, z: 2 } };
  const hud = new SceneHud(); hud.update(375, 812, selected);
  const elements = layoutSceneHud(375, 812, selected);
  assert.ok(elements.some(e => e.label === "炸掉这个格子？"));
  assert.equal(hud.pick(30, 30), "consume");
  for (const action of ["bombConfirm", "bombCancel"]) {
    const button = elements.find(e => e.action === action);
    assert.equal(hud.pick(button.x + 10, button.y + 10), action);
  }
});
