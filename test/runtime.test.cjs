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

test("adapts wx canvas to the DOM event APIs expected by Three.js", () => {
  const wxCanvas = { runtime: "wechat" };
  const touchHandlers = {};

  const observed = runMain({
    document: {},
    wx: {
      createCanvas: () => wxCanvas,
      getSystemInfoSync: () => ({ windowWidth: 320, windowHeight: 640 }),
      onTouchCancel: (handler) => {
        touchHandlers.cancel = handler;
      },
      onTouchEnd: (handler) => {
        touchHandlers.end = handler;
      },
      onTouchMove: (handler) => {
        touchHandlers.move = handler;
      },
      onTouchStart: (handler) => {
        touchHandlers.start = handler;
      }
    }
  });

  assert.equal(observed.canvas, wxCanvas);
  assert.equal(typeof observed.canvas.addEventListener, "function");
  assert.equal(typeof observed.canvas.removeEventListener, "function");
  assert.equal(typeof observed.canvas.getBoundingClientRect, "function");
  assert.equal(typeof observed.canvas.setAttribute, "function");

  const rect = observed.canvas.getBoundingClientRect();
  assert.equal(rect.width, 320);
  assert.equal(rect.height, 640);

  let receivedPointer = null;
  observed.canvas.addEventListener("pointerdown", (event) => {
    receivedPointer = event;
  });

  touchHandlers.start({
    changedTouches: [{ identifier: 7, clientX: 12, clientY: 34 }]
  });

  assert.equal(receivedPointer.pointerId, 7);
  assert.equal(receivedPointer.clientX, 12);
  assert.equal(receivedPointer.clientY, 34);
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
