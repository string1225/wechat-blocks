declare const wx:
  | {
      createCanvas?: () => HTMLCanvasElement;
      getSystemInfoSync?: () => { windowWidth: number; windowHeight: number };
    }
  | undefined;
