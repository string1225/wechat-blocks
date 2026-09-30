import { formatTime } from "./formatTime";
import { createIcons, icons } from "lucide";
import type { GameUi, ResultState, UiHandlers, UiState } from "./GameUi";

export class BrowserHud implements GameUi {
  private readonly timer = mustGet<HTMLElement>("hud-timer");
  private readonly difficulty = mustGet<HTMLElement>("hud-difficulty");
  private readonly difficultyPrev = mustGet<HTMLButtonElement>("hud-difficulty-prev");
  private readonly difficultyNext = mustGet<HTMLButtonElement>("hud-difficulty-next");
  private readonly left = mustGet<HTMLElement>("hud-left");
  private readonly reset = mustGet<HTMLButtonElement>("hud-reset");
  private readonly undo = mustGet<HTMLButtonElement>("hud-undo");
  private readonly bomb = mustGet<HTMLButtonElement>("hud-bomb");
  private readonly bombDialog = mustGet<HTMLElement>("bomb-dialog");
  private readonly bombHint = mustGet<HTMLElement>("bomb-hint");
  private readonly auto = mustGet<HTMLButtonElement>("hud-auto");
  private readonly zoomIn = mustGet<HTMLButtonElement>("hud-zoom-in");
  private readonly zoomOut = mustGet<HTMLButtonElement>("hud-zoom-out");
  private readonly undoCount = mustGet<HTMLElement>("hud-undo-count");
  private readonly bombCount = mustGet<HTMLElement>("hud-bomb-count");
  private readonly toast = mustGet<HTMLElement>("toast");
  private readonly result = mustGet<HTMLElement>("result");
  private readonly resultTitle = mustGet<HTMLElement>("result-title");
  private readonly resultCopy = mustGet<HTMLElement>("result-copy");
  private readonly resultRetry = mustGet<HTMLButtonElement>("result-retry");
  private readonly resultNext = mustGet<HTMLButtonElement>("result-next");

  private handlers: UiHandlers | null = null;
  private toastTimer = 0;
  private currentLevel = 1;

  bind(handlers: UiHandlers): void {
    this.handlers = handlers;
    this.difficultyPrev.addEventListener("click", () => {
      if (this.currentLevel > 1) {
        handlers.onLevel(this.currentLevel - 1);
      }
    });
    this.difficultyNext.addEventListener("click", () => {
      handlers.onLevel(this.currentLevel + 1);
    });
    this.reset.addEventListener("click", () => handlers.onReset());
    this.undo.addEventListener("click", () => handlers.onUndo());
    this.bomb.addEventListener("click", () => handlers.onBomb());
    mustGet("bomb-confirm").addEventListener("click", () => handlers.onBombConfirm());
    mustGet("bomb-cancel").addEventListener("click", () => handlers.onBombCancel());
    this.auto.addEventListener("click", () => handlers.onAuto());
    this.zoomIn.addEventListener("click", () => handlers.onZoomIn());
    this.zoomOut.addEventListener("click", () => handlers.onZoomOut());
    this.resultRetry.addEventListener("click", () => handlers.onReset());
    this.resultNext.addEventListener("click", () => handlers.onNext());
    renderIcons();
  }

  update(state: UiState): void {
    this.currentLevel = state.level;

    this.timer.textContent = formatTime(state.elapsedSeconds);
    this.difficulty.textContent = String(state.level);
    this.left.textContent = String(state.remaining);
    this.undoCount.textContent = `${state.powerups.undo} 次可用`;
    this.bombCount.textContent = state.bombArmed ? "点选方块" : `${state.powerups.bomb} 枚可用`;
    this.bomb.dataset.active = String(state.bombArmed);
    this.bomb.setAttribute("aria-pressed", String(state.bombArmed));
    this.bombDialog.dataset.visible = String(state.bombTarget !== null && state.phase === "playing");
    this.bombHint.hidden = !state.bombArmed || state.phase !== "playing";

    this.difficultyPrev.disabled = state.level <= 1;
    this.difficultyNext.disabled = false;
    this.undo.disabled = !state.canUndo || state.phase !== "playing";
    this.bomb.disabled = state.powerups.bomb <= 0 || state.remaining <= 0 || state.phase !== "playing";
    this.auto.disabled = state.remaining <= 0 || state.phase !== "playing";
    this.auto.dataset.active = String(state.autoRunning);
    this.auto.setAttribute("aria-pressed", String(state.autoRunning));

    const autoIcon = state.autoRunning ? "pause" : "play";
    const currentIcon = this.auto.querySelector("svg")?.getAttribute("data-lucide");
    if (currentIcon !== autoIcon) {
      const label = this.auto.querySelector(".tool-copy")?.outerHTML ?? "";
      this.auto.innerHTML = `<i data-lucide="${autoIcon}"></i>${label}`;
      renderIcons();
    }
    mustGet<HTMLElement>("hud-auto-state").textContent = state.autoRunning ? "进行中" : "已关闭";
  }

  showToast(message: string): void {
    window.clearTimeout(this.toastTimer);
    this.toast.textContent = message;
    this.toast.dataset.visible = "true";
    this.toastTimer = window.setTimeout(() => {
      this.toast.dataset.visible = "false";
    }, 780);
  }

  showResult(result: ResultState): void {
    this.resultTitle.textContent = result.phase === "won" ? "过关" : "未完成";
    this.resultCopy.textContent =
      result.phase === "won"
        ? `难度 ${result.level} · 用时 ${formatTime(result.elapsedSeconds)} · ${renderStars(result.stars)}`
        : `难度 ${result.level} · 用时 ${formatTime(result.elapsedSeconds)}`;
    this.resultNext.disabled = result.phase !== "won";
    this.result.dataset.visible = "true";
  }

  hideResult(): void {
    this.result.dataset.visible = "false";
  }
}

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: #${id}`);
  }
  return element as T;
}

function renderStars(count: number): string {
  return `${"★".repeat(count)}${"☆".repeat(Math.max(0, 3 - count))}`;
}

function renderIcons(): void {
  createIcons({ icons });
}
