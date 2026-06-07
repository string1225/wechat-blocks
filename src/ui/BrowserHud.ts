import { createIcons, icons } from "lucide";
import type { GameUi, ResultState, UiHandlers, UiState } from "./GameUi";

export class BrowserHud implements GameUi {
  private readonly level = mustGet<HTMLElement>("hud-level");
  private readonly moves = mustGet<HTMLElement>("hud-moves");
  private readonly left = mustGet<HTMLElement>("hud-left");
  private readonly stars = mustGet<HTMLElement>("hud-stars");
  private readonly next = mustGet<HTMLButtonElement>("hud-next");
  private readonly reset = mustGet<HTMLButtonElement>("hud-reset");
  private readonly undo = mustGet<HTMLButtonElement>("hud-undo");
  private readonly bomb = mustGet<HTMLButtonElement>("hud-bomb");
  private readonly auto = mustGet<HTMLButtonElement>("hud-auto");
  private readonly zoomIn = mustGet<HTMLButtonElement>("hud-zoom-in");
  private readonly zoomOut = mustGet<HTMLButtonElement>("hud-zoom-out");
  private readonly undoCount = mustGet<HTMLElement>("hud-undo-count");
  private readonly bombCount = mustGet<HTMLElement>("hud-bomb-count");
  private readonly autoState = mustGet<HTMLElement>("hud-auto-state");
  private readonly levelStrip = mustGet<HTMLElement>("level-strip");
  private readonly toast = mustGet<HTMLElement>("toast");
  private readonly result = mustGet<HTMLElement>("result");
  private readonly resultTitle = mustGet<HTMLElement>("result-title");
  private readonly resultCopy = mustGet<HTMLElement>("result-copy");
  private readonly resultRetry = mustGet<HTMLButtonElement>("result-retry");
  private readonly resultNext = mustGet<HTMLButtonElement>("result-next");

  private handlers: UiHandlers | null = null;
  private toastTimer = 0;
  private renderedLevelCount = 0;

  bind(handlers: UiHandlers): void {
    this.handlers = handlers;
    this.next.addEventListener("click", () => handlers.onNext());
    this.reset.addEventListener("click", () => handlers.onReset());
    this.undo.addEventListener("click", () => handlers.onUndo());
    this.bomb.addEventListener("click", () => handlers.onBomb());
    this.auto.addEventListener("click", () => handlers.onAuto());
    this.zoomIn.addEventListener("click", () => handlers.onZoomIn());
    this.zoomOut.addEventListener("click", () => handlers.onZoomOut());
    this.resultRetry.addEventListener("click", () => handlers.onReset());
    this.resultNext.addEventListener("click", () => handlers.onNext());
    renderIcons();
  }

  update(state: UiState): void {
    if (state.levelCount !== this.renderedLevelCount) {
      this.renderLevelButtons(state.levelCount);
    }

    this.level.textContent = String(state.level);
    this.moves.textContent = `${state.moves}/${state.maxMoves}`;
    this.left.textContent = String(state.remaining);
    this.stars.textContent = renderStars(state.stars);
    this.undoCount.textContent = String(state.powerups.undo);
    this.bombCount.textContent = String(state.powerups.bomb);
    this.autoState.textContent = state.autoRunning ? "开启" : "关闭";

    this.next.disabled = state.level >= state.levelCount;
    this.undo.disabled = !state.canUndo || state.phase !== "playing";
    this.bomb.disabled = state.powerups.bomb <= 0 || state.remaining <= 0 || state.phase !== "playing";
    this.auto.disabled = state.remaining <= 0 || state.phase !== "playing";
    this.auto.dataset.active = String(state.autoRunning);

    const autoIcon = state.autoRunning ? "pause" : "play";
    const currentIcon = this.auto.querySelector("svg")?.getAttribute("data-lucide");
    if (currentIcon !== autoIcon) {
      const label = this.auto.querySelector(".tool-copy")?.outerHTML ?? "";
      this.auto.innerHTML = `<i data-lucide="${autoIcon}"></i>${label}`;
      renderIcons();
    }

    for (const button of Array.from(this.levelStrip.querySelectorAll<HTMLButtonElement>(".level-button"))) {
      button.dataset.active = String(Number(button.dataset.level) === state.level);
    }
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
        ? `第 ${result.level} 关 · ${result.moves} 步 · ${renderStars(result.stars)}`
        : `第 ${result.level} 关 · ${result.moves} 步`;
    this.resultNext.disabled = result.phase !== "won";
    this.result.dataset.visible = "true";
  }

  hideResult(): void {
    this.result.dataset.visible = "false";
  }

  private renderLevelButtons(levelCount: number): void {
    this.levelStrip.replaceChildren();
    this.renderedLevelCount = levelCount;

    for (let level = 1; level <= levelCount; level += 1) {
      const button = document.createElement("button");
      button.className = "level-button";
      button.type = "button";
      button.textContent = String(level);
      button.dataset.level = String(level);
      button.addEventListener("click", () => this.handlers?.onLevel(level));
      this.levelStrip.append(button);
    }
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
