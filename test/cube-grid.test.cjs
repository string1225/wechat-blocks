const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  module._compile(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        useDefineForClassFields: true
      },
      fileName: filename
    }).outputText,
    filename
  );
};

const { BLOCK_SIZE, CubeGrid } = require("../src/world/CubeGrid.ts");

const FACE_NORMALS = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
];

test("uses block-sized grid spacing so adjacent blocks touch", () => {
  const grid = createGrid();

  assert.equal(BLOCK_SIZE, 0.82);
  assert.equal(grid.gap, BLOCK_SIZE);
});

test("all six faces click toward the block flight direction", () => {
  const grid = createGrid();

  for (const block of grid.blocks) {
    const direction = block.faceArrows[0].direction;
    const directionalFaces = FACE_NORMALS.filter((normal) => Math.abs(dot(normal, direction)) === 1);

    assert.equal(block.faceArrows.length, 4);
    assert.equal(directionalFaces.length, 2);
    assert.equal(block.faceArrows.some((arrow) => Math.abs(dot(arrow.normal, direction)) === 1), false);

    for (const normal of FACE_NORMALS) {
      assert.deepEqual(grid.getDirectionForFace(block, normal), direction);
    }
  }
});

function createGrid() {
  return new CubeGrid({
    id: 1,
    maxMoves: 72,
    seed: 12648430,
    size: 4
  });
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
