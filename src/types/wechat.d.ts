declare const wx:
  | {
      createCanvas?: () => HTMLCanvasElement;
      getSystemInfoSync?: () => { windowWidth: number; windowHeight: number };
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
