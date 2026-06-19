declare const wx:
  | {
      createCanvas?: () => HTMLCanvasElement;
      getMenuButtonBoundingClientRect?: () => WechatMenuButtonRect;
      getSystemInfoSync?: () => WechatSystemInfo;
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
