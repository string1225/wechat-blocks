import { LEVEL_COUNT, getLevelConfig } from "../data/levels";
import { chooseBestCluster } from "../systems/solver";
import type { GameUi, UiState } from "../ui/GameUi";
import { CubeGrid, type GridBlock } from "../world/CubeGrid";
import { GameScene } from "./GameScene";
import { InputController } from "./InputController";
import type { GamePhase, LevelConfig, PowerupState, TurnSnapshot } from "./types";

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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: GameUi
  ) {
    this.scene = new GameScene(canvas);
    this.input = new InputController(canvas, {
      onTap: (clientX, clientY) => this.handleTap(clientX, clientY),
      onRotate: (deltaX, deltaY) => this.scene.rotate(deltaX, deltaY),
      onZoom: (scale) => this.scene.zoom(scale)
    });

    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => this.scene.resize());
    }

    this.loadLevel(1);
  }

  start(): void {
    this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  loadLevel(levelId: number): void {
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
      this.ui.showToast("已到最后一关");
      return;
    }

    this.loadLevel(this.level.id + 1);
  }

  undo(): void {
    if (this.phase !== "playing" || this.grid.isAnimating() || this.powerups.undo <= 0) {
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
    this.ui.showToast("已撤销");
    this.updateUi();
  }

  useBomb(): void {
    if (this.phase !== "playing" || this.grid.isAnimating() || this.powerups.bomb <= 0) {
      return;
    }

    const activeBlocks = this.grid.activeBlocks;
    const target = activeBlocks[Math.floor(Math.random() * activeBlocks.length)];
    if (!target) {
      return;
    }

    this.powerups.bomb -= 1;
    this.eliminate([target], "炸弹");
  }

  toggleAuto(): void {
    if (this.phase !== "playing" || this.grid.activeCount <= 0) {
      return;
    }

    this.autoRunning = !this.autoRunning;
    this.autoCooldown = 0;
    this.ui.showToast(this.autoRunning ? "自动运行" : "已暂停");
    this.updateUi();
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
    if (this.phase !== "playing" || this.grid.isAnimating()) {
      return;
    }

    const instanceId = this.scene.pickInstance(clientX, clientY);
    if (instanceId === null) {
      return;
    }

    const block = this.grid.getBlockByInstanceId(instanceId);
    if (!block) {
      return;
    }

    const cluster = this.grid.getCluster(block);
    this.eliminate(cluster, "点击");
  }

  private eliminate(blocks: readonly GridBlock[], source: string): void {
    if (blocks.length === 0 || this.phase !== "playing") {
      return;
    }

    this.history.push({
      grid: this.grid.snapshot(),
      moves: this.moves
    });
    this.history = this.history.slice(-30);
    this.moves += 1;

    const removed = this.grid.beginRemoval(blocks);
    if (removed > 1) {
      this.ui.showToast(`${source} x${removed}`);
    }

    this.updateUi();
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

    const cluster = chooseBestCluster(this.grid);
    if (cluster.length === 0) {
      this.autoRunning = false;
      this.updateUi();
      return;
    }

    this.eliminate(cluster, "连消");
    this.autoCooldown = 0.42;
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
      canUndo: this.history.length > 0 && this.powerups.undo > 0 && !this.grid.isAnimating(),
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
