export interface Position3 {
  x: number;
  y: number;
  z: number;
}

export interface LevelConfig {
  id: number;
  name: string;
  size: number;
  maxMoves: number;
  starThresholds: readonly [number, number, number];
  seed: number;
  palette: readonly string[];
}

export interface BlockSnapshot {
  id: string;
  instanceId: number;
  grid: Position3;
  color: string;
  active: boolean;
}

export interface GridSnapshot {
  blocks: BlockSnapshot[];
}

export interface TurnSnapshot {
  grid: GridSnapshot;
  moves: number;
}

export interface PowerupState {
  undo: number;
  bomb: number;
}

export type GamePhase = "playing" | "won" | "failed";
