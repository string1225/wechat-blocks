export function createTextureCanvas(width: number, height: number): HTMLCanvasElement {
  // WeChat may expose a partial document shim; prefer its real canvas APIs.
  const runtime = typeof wx !== "undefined" ? wx : undefined;
  const canvas = runtime?.createOffscreenCanvas?.({ type: "2d", width, height })
    ?? runtime?.createCanvas?.()
    ?? (typeof document !== "undefined" ? document.createElement("canvas") : undefined);
  if (!canvas) throw new Error("No canvas available for game textures.");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
