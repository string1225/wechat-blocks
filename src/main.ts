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
  onUndo: () => game.undo()
});

game.start();

function createRuntime(): { canvas: HTMLCanvasElement; ui: GameUi } {
  if (typeof document !== "undefined") {
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
  if (!canvas) {
    throw new Error("No supported canvas runtime found.");
  }

  return {
    canvas,
    ui: new NoopHud()
  };
}
