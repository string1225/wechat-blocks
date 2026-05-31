export interface InputHandlers {
  onTap: (clientX: number, clientY: number) => void;
  onRotate: (deltaX: number, deltaY: number) => void;
  onZoom: (scale: number) => void;
}

interface PointerRecord {
  x: number;
  y: number;
  startX: number;
  startY: number;
  startedAt: number;
}

export class InputController {
  private readonly pointers = new Map<number, PointerRecord>();
  private pinchDistance = 0;
  private hadMultiTouch = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: InputHandlers
  ) {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.canvas.removeEventListener("wheel", this.handleWheel);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now()
    });

    if (this.pointers.size >= 2) {
      this.hadMultiTouch = true;
      this.pinchDistance = this.getPinchDistance();
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      return;
    }

    const deltaX = event.clientX - pointer.x;
    const deltaY = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (this.pointers.size >= 2) {
      const nextDistance = this.getPinchDistance();
      if (this.pinchDistance > 0 && nextDistance > 0) {
        this.handlers.onZoom(this.pinchDistance / nextDistance);
      }
      this.pinchDistance = nextDistance;
      return;
    }

    if (Math.abs(deltaX) + Math.abs(deltaY) > 0.5) {
      this.handlers.onRotate(deltaX, deltaY);
    }
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      return;
    }

    this.pointers.delete(event.pointerId);
    this.canvas.releasePointerCapture?.(event.pointerId);

    const travel = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
    const duration = performance.now() - pointer.startedAt;
    const isTap = travel < 7 && duration < 360 && !this.hadMultiTouch;

    if (isTap) {
      this.handlers.onTap(event.clientX, event.clientY);
    }

    if (this.pointers.size < 2) {
      this.pinchDistance = 0;
      this.hadMultiTouch = false;
    }
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.handlers.onZoom(event.deltaY > 0 ? 1.08 : 0.92);
  };

  private getPinchDistance(): number {
    const points = Array.from(this.pointers.values());
    const first = points[0];
    const second = points[1];
    if (!first || !second) {
      return 0;
    }
    return Math.hypot(first.x - second.x, first.y - second.y);
  }
}
