import { Game } from "./game/Game";
import { BrowserHud } from "./ui/BrowserHud";
import type { GameUi } from "./ui/GameUi";
import { NoopHud } from "./ui/NoopHud";

const { canvas, ui } = createRuntime();
const game = new Game(canvas, ui);

ui.bind({
  onAuto: () => game.toggleAuto(),
  onBomb: () => game.useBomb(),
  onLevel: (level) => game.loadLevel(level),
  onNext: () => game.nextLevel(),
  onReset: () => game.resetLevel(),
  onUndo: () => game.undo(),
  onZoomIn: () => game.zoomIn(),
  onZoomOut: () => game.zoomOut()
});

game.start();

function createRuntime(): { canvas: HTMLCanvasElement; ui: GameUi } {
  if (hasBrowserCanvasDocument()) {
    const canvas = document.getElementById("game-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Missing browser canvas.");
    }

    return {
      canvas,
      ui: new BrowserHud()
    };
  }

  const maybeWx = typeof wx !== "undefined" ? wx : undefined;
  const canvas = maybeWx?.createCanvas?.();
  if (!canvas || !maybeWx) {
    throw new Error("No supported canvas runtime found.");
  }

  return {
    canvas: prepareWechatCanvas(canvas, maybeWx),
    ui: new NoopHud()
  };
}

function hasBrowserCanvasDocument(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.getElementById === "function" &&
    typeof HTMLCanvasElement !== "undefined"
  );
}

type WechatRuntime = NonNullable<typeof wx>;
type CanvasListener = EventListenerOrEventListenerObject;

type WechatCanvas = {
  addEventListener?: (type: string, listener: CanvasListener | null, options?: unknown) => void;
  clientHeight?: number;
  clientWidth?: number;
  dispatchEvent?: (event: Event) => boolean;
  getAttribute?: (name: string) => string | null;
  getBoundingClientRect?: () => Pick<DOMRect, "bottom" | "height" | "left" | "right" | "top" | "width" | "x" | "y">;
  height?: number;
  releasePointerCapture?: (pointerId: number) => void;
  removeEventListener?: (type: string, listener: CanvasListener | null, options?: unknown) => void;
  setAttribute?: (name: string, value: string) => void;
  setPointerCapture?: (pointerId: number) => void;
  style?: Record<string, string>;
  width?: number;
};

type WechatTouch = {
  clientX?: number;
  clientY?: number;
  identifier?: number;
  pageX?: number;
  pageY?: number;
  x?: number;
  y?: number;
};

type WechatTouchEvent = {
  changedTouches?: WechatTouch[];
  touches?: WechatTouch[];
};

function prepareWechatCanvas(canvas: HTMLCanvasElement, wxRuntime: WechatRuntime): HTMLCanvasElement {
  const target = canvas as unknown as WechatCanvas;
  const attributes = new Map<string, string>();
  const systemInfo = wxRuntime.getSystemInfoSync?.();
  const width = Math.max(1, target.width || systemInfo?.windowWidth || globalThis.innerWidth || 1);
  const height = Math.max(1, target.height || systemInfo?.windowHeight || globalThis.innerHeight || 1);

  target.width = target.width || width;
  target.height = target.height || height;
  target.style ??= {};
  target.setAttribute ??= (name, value) => {
    attributes.set(name, value);
  };
  target.getAttribute ??= (name) => attributes.get(name) ?? null;
  target.setPointerCapture ??= () => {};
  target.releasePointerCapture ??= () => {};
  defineNumberGetter(target, "clientWidth", () => target.width || width);
  defineNumberGetter(target, "clientHeight", () => target.height || height);
  target.getBoundingClientRect ??= () => {
    const rectWidth = target.clientWidth || width;
    const rectHeight = target.clientHeight || height;
    return {
      bottom: rectHeight,
      height: rectHeight,
      left: 0,
      right: rectWidth,
      top: 0,
      width: rectWidth,
      x: 0,
      y: 0
    };
  };

  if (typeof target.addEventListener !== "function" || typeof target.removeEventListener !== "function") {
    installCanvasEventTarget(target, wxRuntime);
  }

  return target as unknown as HTMLCanvasElement;
}

function defineNumberGetter(target: WechatCanvas, key: "clientHeight" | "clientWidth", getValue: () => number): void {
  if (typeof target[key] === "number" && target[key]! > 0) {
    return;
  }

  try {
    Object.defineProperty(target, key, {
      configurable: true,
      get: getValue
    });
  } catch {
    target[key] = getValue();
  }
}

function installCanvasEventTarget(target: WechatCanvas, wxRuntime: WechatRuntime): void {
  const listeners = new Map<string, Set<CanvasListener>>();
  const addListener = (type: string, listener: CanvasListener | null): void => {
    if (!listener) {
      return;
    }

    const bucket = listeners.get(type) ?? new Set<CanvasListener>();
    bucket.add(listener);
    listeners.set(type, bucket);
  };
  const removeListener = (type: string, listener: CanvasListener | null): void => {
    if (!listener) {
      return;
    }

    listeners.get(type)?.delete(listener);
  };
  const dispatch = (event: Event): boolean => {
    const eventType = event.type;
    for (const listener of listeners.get(eventType) ?? []) {
      if (typeof listener === "function") {
        listener.call(target, event);
      } else {
        listener.handleEvent(event);
      }
    }
    return true;
  };

  target.addEventListener = addListener;
  target.removeEventListener = removeListener;
  target.dispatchEvent = dispatch;

  wxRuntime.onTouchStart?.((event) => dispatchWechatTouches(target, listeners, "pointerdown", event));
  wxRuntime.onTouchMove?.((event) => dispatchWechatTouches(target, listeners, "pointermove", event));
  wxRuntime.onTouchEnd?.((event) => dispatchWechatTouches(target, listeners, "pointerup", event));
  wxRuntime.onTouchCancel?.((event) => dispatchWechatTouches(target, listeners, "pointercancel", event));
}

function dispatchWechatTouches(
  target: WechatCanvas,
  listeners: ReadonlyMap<string, ReadonlySet<CanvasListener>>,
  type: string,
  event: WechatTouchEvent
): void {
  const touches = event.changedTouches?.length ? event.changedTouches : event.touches ?? [];

  for (const touch of touches) {
    const pointerEvent = createWechatPointerEvent(target, type, touch);
    for (const listener of listeners.get(type) ?? []) {
      if (typeof listener === "function") {
        listener.call(target, pointerEvent as unknown as Event);
      } else {
        listener.handleEvent(pointerEvent as unknown as Event);
      }
    }
  }
}

function createWechatPointerEvent(target: WechatCanvas, type: string, touch: WechatTouch): PointerEvent {
  const clientX = touch.clientX ?? touch.x ?? touch.pageX ?? 0;
  const clientY = touch.clientY ?? touch.y ?? touch.pageY ?? 0;

  return {
    button: 0,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    cancelable: true,
    clientX,
    clientY,
    currentTarget: target,
    isPrimary: true,
    pointerId: touch.identifier ?? 1,
    preventDefault() {},
    stopPropagation() {},
    target,
    timeStamp: now(),
    type
  } as unknown as PointerEvent;
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
