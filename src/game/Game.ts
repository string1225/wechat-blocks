import { LEVEL_COUNT, getLevelConfig } from "../data/levels";
import { chooseBestBlock } from "../systems/solver";
import type { GameUi, UiState } from "../ui/GameUi";
import { CubeGrid, type GridBlock } from "../world/CubeGrid";
import { GameScene } from "./GameScene";
import { InputController } from "./InputController";
import { now } from "../platform/clock";
import { ProgressStore } from "../progress/ProgressStore";
import { compactGrid, expandGrid, type GameProgress } from "../progress/schema";
import type { GamePhase, LevelConfig, Position3, PowerupState, TurnSnapshot } from "./types";

type FlightSource = "Fly" | "Bomb" | "Silent";

export interface GameOptions {
  sceneHud?: boolean;
}

export class Game {
  private readonly scene: GameScene;
  private readonly input: InputController;
  private level!: LevelConfig;
  private grid!: CubeGrid;
  private moves = 0;
  private phase: GamePhase = "playing";
  private powerups: PowerupState = { undo: 5, bomb: 3 };
  private history: TurnSnapshot[] = [];
  private autoRunning = false;
  private autoCooldown = 0;
  private lastTime = 0;
  private resultShown = false;
  private debugCooldown = 0;
  private readonly progress = new ProgressStore();
  private ready = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: GameUi,
    options: GameOptions = {}
  ) {
    this.scene = new GameScene(canvas, { sceneHud: options.sceneHud ?? false });
    this.input = new InputController(canvas, {
      onTap: (clientX, clientY) => this.handleTap(clientX, clientY),
      onRotate: (deltaX, deltaY) => this.scene.rotate(deltaX, deltaY),
      onZoom: (scale) => this.scene.zoom(scale)
    });

    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => this.scene.resize());
    }

    if (this.progress.current) this.restoreProgress(this.progress.current);
    else this.setLevel(1);
  }

  start(): void {
    this.lastTime = now();
    requestAnimationFrame(this.tick);
    void this.progress.connect((saved) => {
      if (saved) this.restoreProgress(saved);
      else this.setLevel(1);
    }).then((saved) => {
      if (saved) this.restoreProgress(saved);
      else this.setLevel(1);
      this.ready = true;
      this.saveProgress();
    });
  }

  loadLevel(levelId: number): void {
    if (!this.ready) return;
    this.setLevel(levelId);
    this.saveProgress();
  }

  private setLevel(levelId: number): void {
    this.level = getLevelConfig(levelId);
    this.grid = new CubeGrid(this.level);
    this.moves = 0;
    this.phase = "playing";
    this.powerups = { undo: 5, bomb: 3 };
    this.history = [];
    this.autoRunning = false;
    this.autoCooldown = 0;
    this.resultShown = false;
    this.ui.hideResult();
    this.scene.loadBlocks(this.grid.blocks, this.level.size);
    this.updateUi();
  }

  resetLevel(): void {
    this.loadLevel(this.level.id);
  }

  nextLevel(): void {
    if (this.level.id >= LEVEL_COUNT) {
      this.ui.showToast("Last level");
      return;
    }

    this.loadLevel(this.level.id + 1);
  }

  undo(): void {
    if (!this.ready || this.phase !== "playing" || this.grid.isAnimating() || this.powerups.undo <= 0) {
      return;
    }

    const snapshot = this.history.pop();
    if (!snapshot) {
      return;
    }

    this.powerups.undo -= 1;
    this.moves = snapshot.moves;
    this.grid.restore(snapshot.grid);
    this.scene.updateBlocks(this.grid.blocks);
    this.ui.showToast("Undo");
    this.updateUi();
    this.saveProgress();
  }

  useBomb(): void {
    if (!this.ready || this.phase !== "playing" || this.grid.isAnimating() || this.powerups.bomb <= 0) {
      return;
    }

    const movableBlocks = this.grid.activeBlocks.filter((block) =>
      block.faceArrows.some((arrow) => this.grid.canExit(block, arrow.direction))
    );
    const target = movableBlocks[Math.floor(Math.random() * movableBlocks.length)];
    if (!target) {
      this.ui.showToast("Blocked");
      return;
    }

    this.powerups.bomb -= 1;
    this.flyBlock(target, this.pickAutoDirection(target), "Bomb");
  }

  toggleAuto(): void {
    if (!this.ready || this.phase !== "playing" || this.grid.activeCount <= 0) {
      return;
    }

    this.autoRunning = !this.autoRunning;
    this.autoCooldown = 0;
    this.updateUi();
  }

  zoomIn(): void {
    this.scene.zoom(0.84);
  }

  zoomOut(): void {
    this.scene.zoom(1.19);
  }

  private readonly tick = (time: number): void => {
    const dt = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;

    const update = this.grid.update(dt);
    if (update.changed) {
      this.scene.updateBlocks(this.grid.blocks);
      this.checkProgress();
      this.updateUi();
    } else if (update.animating) {
      this.scene.updateBlocks(this.grid.blocks);
    }

    this.runAuto(dt);
    this.scene.render();
    this.publishDebug(dt);
    requestAnimationFrame(this.tick);
  };

  private handleTap(clientX: number, clientY: number): void {
    if (!this.ready) return;
    const hudAction = this.scene.pickHudAction(clientX, clientY);
    if (hudAction) {
      this.handleHudAction(hudAction);
      return;
    }

    if (this.phase !== "playing" || this.grid.isAnimating()) {
      return;
    }

    const pick = this.scene.pickBlock(clientX, clientY);
    if (!pick) {
      return;
    }

    const block = this.grid.getBlockByInstanceId(pick.instanceId);
    if (!block) {
      return;
    }

    const direction = this.grid.getDirectionForFace(block, pick.faceNormal);
    if (direction) {
      this.flyBlock(block, direction, "Fly");
    }
  }

  private flyBlock(block: GridBlock, direction: Position3, source: FlightSource): boolean {
    if (this.phase !== "playing") {
      return false;
    }

    const snapshot: TurnSnapshot = {
      grid: this.grid.snapshot(),
      moves: this.moves
    };

    if (!this.grid.beginFlight(block, direction)) {
      return false;
    }

    this.history.push(snapshot);
    this.history = this.history.slice(-30);
    this.moves += 1;
    if (source === "Bomb") {
      this.ui.showToast("Bomb");
    }
    this.updateUi();
    this.saveProgress();
    return true;
  }

  private saveProgress(): void {
    if (!this.ready) return;
    const blocks = compactGrid(this.grid.settledSnapshot());
    this.progress.save({
      version: 1, level: this.level.id, moves: this.moves,
      phase: blocks.length === 0 ? "won" : this.moves >= this.level.maxMoves ? "failed" : "playing",
      blocks, powerups: { ...this.powerups },
      history: this.history.map((turn) => ({ moves: turn.moves, blocks: compactGrid(turn.grid) }))
    });
  }

  private restoreProgress(saved: GameProgress): void {
    if (saved.phase === "won" && saved.level < LEVEL_COUNT) {
      this.setLevel(saved.level + 1);
      this.saveProgress();
      return;
    }
    if (saved.phase === "failed") {
      this.setLevel(saved.level);
      this.saveProgress();
      return;
    }
    this.level = getLevelConfig(saved.level);
    this.grid = new CubeGrid(this.level);
    const template = this.grid.snapshot();
    this.grid.restore(expandGrid(saved.blocks, template));
    this.moves = saved.moves;
    this.phase = saved.phase;
    this.powerups = { ...saved.powerups };
    this.history = saved.history.map((turn) => ({ moves: turn.moves, grid: expandGrid(turn.blocks, template) }));
    this.autoRunning = false;
    this.autoCooldown = 0;
    this.resultShown = false;
    this.ui.hideResult();
    this.scene.loadBlocks(this.grid.blocks, this.level.size);
    this.updateUi();
    if (this.phase === "won") this.showResultOnce();
  }

  private handleHudAction(action: string): void {
    switch (action) {
      case "auto":
        this.toggleAuto();
        return;
      case "bomb":
        this.useBomb();
        return;
      case "levelNext":
        this.nextLevel();
        return;
      case "levelPrev":
        this.loadLevel(Math.max(1, this.level.id - 1));
        return;
      case "reset":
        this.resetLevel();
        return;
      case "undo":
        this.undo();
        return;
    }
  }

  private runAuto(dt: number): void {
    if (!this.autoRunning || this.phase !== "playing") {
      return;
    }

    if (this.grid.isAnimating()) {
      return;
    }

    this.autoCooldown -= dt;
    if (this.autoCooldown > 0) {
      return;
    }

    const move = this.pickAutoMove();
    if (!move) {
      this.autoRunning = false;
      this.updateUi();
      return;
    }

    this.flyBlock(move.block, move.direction, "Silent");
    this.autoCooldown = 0.28;
  }

  private checkProgress(): void {
    if (this.phase !== "playing") {
      return;
    }

    if (this.grid.activeCount === 0) {
      this.phase = "won";
      this.autoRunning = false;
      this.showResultOnce();
      return;
    }

    if (this.moves >= this.level.maxMoves) {
      this.phase = "failed";
      this.autoRunning = false;
      this.showResultOnce();
    }
  }

  private showResultOnce(): void {
    if (this.resultShown) {
      return;
    }

    this.resultShown = true;
    this.ui.showResult({
      phase: this.phase === "won" ? "won" : "failed",
      level: this.level.id,
      moves: this.moves,
      stars: this.calculateStars()
    });
  }

  private updateUi(): void {
    const state: UiState = {
      autoRunning: this.autoRunning,
      canUndo: this.history.length > 0 && this.powerups.undo > 0,
      level: this.level.id,
      levelCount: LEVEL_COUNT,
      maxMoves: this.level.maxMoves,
      moves: this.moves,
      phase: this.phase,
      powerups: { ...this.powerups },
      remaining: this.grid.activeCount,
      stars: this.calculateStars()
    };
    this.ui.update(state);
    this.scene.setHudState(state);
  }

  private calculateStars(): number {
    if (this.phase === "failed") {
      return 0;
    }

    const [three, two, one] = this.level.starThresholds;
    if (this.moves <= three) {
      return 3;
    }
    if (this.moves <= two) {
      return 2;
    }
    if (this.moves <= one) {
      return 1;
    }
    return 0;
  }

  private pickAutoDirection(block: GridBlock): Position3 {
    const topArrow = block.faceArrows.find((arrow) => arrow.normal.y === 1);
    return { ...(topArrow ?? block.faceArrows[0]!).direction };
  }

  private pickAutoMove(): { block: GridBlock; direction: Position3 } | null {
    const preferred = chooseBestBlock(this.grid);
    const orderedBlocks = preferred
      ? [preferred, ...this.grid.activeBlocks.filter((block) => block !== preferred)]
      : this.grid.activeBlocks;

    for (const block of orderedBlocks) {
      const preferredDirection = this.pickAutoDirection(block);
      if (this.grid.canExit(block, preferredDirection)) {
        return { block, direction: preferredDirection };
      }

      for (const arrow of block.faceArrows) {
        if (this.grid.canExit(block, arrow.direction)) {
          return { block, direction: { ...arrow.direction } };
        }
      }
    }

    return null;
  }

  private publishDebug(dt: number): void {
    this.debugCooldown -= dt;
    if (this.debugCooldown > 0) {
      return;
    }

    this.debugCooldown = 0.5;
    const target = globalThis as unknown as {
      __WECHAT_BLOCKS_DEBUG_STATE__?: unknown;
    };
    const debugState = {
      autoRunning: this.autoRunning,
      canvas: this.scene.samplePixels(),
      level: this.level.id,
      moves: this.moves,
      phase: this.phase,
      remaining: this.grid.activeCount,
      stars: this.calculateStars()
    };
    target.__WECHAT_BLOCKS_DEBUG_STATE__ = debugState;

    if (typeof this.canvas.setAttribute === "function") {
      this.canvas.setAttribute("data-debug", JSON.stringify(debugState));
    }
  }
}
