import type { GamePhase, PowerupState } from "../game/types";

export interface UiState {
  autoRunning: boolean;
  canUndo: boolean;
  level: number;
  levelCount: number;
  maxMoves: number;
  moves: number;
  phase: GamePhase;
  powerups: PowerupState;
  remaining: number;
  stars: number;
}

export interface ResultState {
  phase: Exclude<GamePhase, "playing">;
  level: number;
  moves: number;
  stars: number;
}

export interface UiHandlers {
  onAuto: () => void;
  onBomb: () => void;
  onLevel: (level: number) => void;
  onNext: () => void;
  onReset: () => void;
  onUndo: () => void;
}

export interface GameUi {
  bind(handlers: UiHandlers): void;
  hideResult(): void;
  showResult(result: ResultState): void;
  showToast(message: string): void;
  update(state: UiState): void;
}
