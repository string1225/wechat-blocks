declare const wx:
  | {
      createCanvas?: () => HTMLCanvasElement;
      getMenuButtonBoundingClientRect?: () => WechatMenuButtonRect;
      getSystemInfoSync?: () => WechatSystemInfo;
      getStorageSync?: (key: string) => unknown;
      setStorageSync?: (key: string, value: string) => void;
      login?: (options: { timeout: number; success: (result: { code: string }) => void; fail: (error: unknown) => void }) => void;
      request?: (options: {
        url: string; method: "GET" | "POST" | "PUT"; header: Record<string, string>; data?: unknown; timeout: number;
        success: (result: { statusCode: number; data: unknown }) => void; fail: (error: unknown) => void;
      }) => void;
      onShow?: (handler: () => void) => void;
      onHide?: (handler: () => void) => void;
      onNetworkStatusChange?: (handler: (state: { isConnected: boolean }) => void) => void;
      onTouchCancel?: (handler: (event: WechatTouchEvent) => void) => void;
      onTouchEnd?: (handler: (event: WechatTouchEvent) => void) => void;
      onTouchMove?: (handler: (event: WechatTouchEvent) => void) => void;
      onTouchStart?: (handler: (event: WechatTouchEvent) => void) => void;
    }
  | undefined;

interface WechatTouchEvent {
  changedTouches?: WechatTouch[];
  touches?: WechatTouch[];
}

interface WechatTouch {
  clientX?: number;
  clientY?: number;
  identifier?: number;
  pageX?: number;
  pageY?: number;
  x?: number;
  y?: number;
}

interface WechatMenuButtonRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface WechatSafeArea {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface WechatSystemInfo {
  pixelRatio?: number;
  safeArea?: WechatSafeArea;
  statusBarHeight?: number;
  windowHeight: number;
  windowWidth: number;
}
