const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const mainSource = readFileSync(path.join(projectRoot, "src", "main.ts"), "utf8");
const mainScript = ts.transpileModule(mainSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    useDefineForClassFields: true
  },
  fileName: "src/main.ts"
}).outputText;

function runMain(globals) {
  const observed = {
    browserHudCreated: false,
    canvas: null,
    noopHudCreated: false,
    started: false
  };

  const module = { exports: {} };
  const context = vm.createContext({
    console,
    exports: module.exports,
    module,
    require: createRequireStub(observed),
    ...globals
  });
  context.globalThis = context;

  vm.runInContext(mainScript, context, { filename: "src/main.ts" });

  return observed;
}

function createRequireStub(observed) {
  return (request) => {
    if (request === "./game/Game") {
      return {
        Game: class FakeGame {
          constructor(canvas) {
            observed.canvas = canvas;
          }

          loadLevel() {}
          nextLevel() {}
          resetLevel() {}
          start() {
            observed.started = true;
          }
          toggleAuto() {}
          undo() {}
          useBomb() {}
          zoomIn() {}
          zoomOut() {}
        }
      };
    }

    if (request === "./ui/BrowserHud") {
      return {
        BrowserHud: class FakeBrowserHud {
          constructor() {
            observed.browserHudCreated = true;
          }

          bind() {}
        }
      };
    }

    if (request === "./ui/NoopHud") {
      return {
        NoopHud: class FakeNoopHud {
          constructor() {
            observed.noopHudCreated = true;
          }

          bind() {}
        }
      };
    }

    throw new Error(`Unexpected require: ${request}`);
  };
}

test("uses wx canvas when WeChat provides a non-DOM document shim", () => {
  const wxCanvas = { runtime: "wechat" };

  const observed = runMain({
    document: {},
    wx: {
      createCanvas: () => wxCanvas
    }
  });

  assert.equal(observed.canvas, wxCanvas);
  assert.equal(observed.noopHudCreated, true);
  assert.equal(observed.browserHudCreated, false);
  assert.equal(observed.started, true);
});

test("uses the browser canvas when a real DOM document is available", () => {
  class FakeHTMLCanvasElement {}
  const browserCanvas = new FakeHTMLCanvasElement();

  const observed = runMain({
    HTMLCanvasElement: FakeHTMLCanvasElement,
    document: {
      getElementById: (id) => (id === "game-canvas" ? browserCanvas : null)
    }
  });

  assert.equal(observed.canvas, browserCanvas);
  assert.equal(observed.browserHudCreated, true);
  assert.equal(observed.noopHudCreated, false);
  assert.equal(observed.started, true);
});
