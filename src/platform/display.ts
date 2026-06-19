export interface HudInsets {
  bottom: number;
  top: number;
}

export function getDevicePixelRatio(): number {
  const browserRatio =
    typeof globalThis.devicePixelRatio === "number" && globalThis.devicePixelRatio > 0
      ? globalThis.devicePixelRatio
      : 0;
  const wxRatio = getWechatSystemInfo()?.pixelRatio ?? 0;

  return Math.min(Math.max(browserRatio || wxRatio || 1, 1), 3);
}

export function getHudInsets(): HudInsets {
  const systemInfo = getWechatSystemInfo();
  const menuRect = getWechatMenuRect();
  const safeArea = systemInfo?.safeArea;
  const windowHeight = systemInfo?.windowHeight ?? globalThis.innerHeight ?? 0;
  const top = Math.max(14, (menuRect?.bottom ?? 0) + 10, (systemInfo?.statusBarHeight ?? safeArea?.top ?? 0) + 12);
  const bottomSafe = safeArea && windowHeight > safeArea.bottom ? windowHeight - safeArea.bottom : 0;

  return {
    bottom: Math.max(18, bottomSafe + 18),
    top
  };
}

function getWechatSystemInfo(): WechatSystemInfo | undefined {
  return typeof wx !== "undefined" ? wx?.getSystemInfoSync?.() : undefined;
}

function getWechatMenuRect(): WechatMenuButtonRect | undefined {
  return typeof wx !== "undefined" ? wx?.getMenuButtonBoundingClientRect?.() : undefined;
}
