import { getLevelConfig } from "../data/levels";
import type { GamePhase, GridSnapshot, Position3, PowerupState } from "../game/types";

export type SavedBlock = [number, number, number, number];
export interface SavedTurn { blocks: SavedBlock[]; moves: number }
export interface GameProgress extends SavedTurn {
  version: 1 | 2 | 3;
  elapsedMs?: number;
  level: number;
  phase: GamePhase;
  powerups: PowerupState;
  history: SavedTurn[];
}

export function compactGrid(grid: GridSnapshot): SavedBlock[] {
  return grid.blocks.filter((block) => block.active)
    .map((block) => [block.instanceId, block.grid.x, block.grid.y, block.grid.z]);
}

export function expandGrid(blocks: SavedBlock[], template: GridSnapshot): GridSnapshot {
  const active = new Map(blocks.map((block) => [block[0], block]));
  return { blocks: template.blocks.map((block) => {
    const saved = active.get(block.instanceId);
    return { ...block, active: !!saved, grid: saved ? { x: saved[1], y: saved[2], z: saved[3] } : block.grid };
  }) };
}

export function isGameProgress(value: unknown): value is GameProgress {
  if (!value || typeof value !== "object") return false;
  const p = value as GameProgress;
  if (![1, 2, 3].includes(p.version) || !integer(p.level, 1, p.version === 1 ? 10 : Number.MAX_SAFE_INTEGER)) return false;
  if (p.elapsedMs !== undefined && !integer(p.elapsedMs, 0, Number.MAX_SAFE_INTEGER)) return false;
  const { dimensions, maxMoves } = getLevelConfig(p.level, p.version);
  if (!integer(p.moves, 0, maxMoves) || !["playing", "won", "failed"].includes(p.phase)) return false;
  if (!p.powerups || !integer(p.powerups.undo, 0, 5) || !integer(p.powerups.bomb, 0, 3)) return false;
  if (!validBlocks(p.blocks, dimensions) || !Array.isArray(p.history) || p.history.length > 30) return false;
  if (!p.history.every((turn) => turn && integer(turn.moves, 0, p.moves - 1) && validBlocks(turn.blocks, dimensions))) return false;
  if (p.phase === "won") return p.blocks.length === 0;
  return p.blocks.length > 0 && (p.phase === "failed" ? p.moves >= maxMoves : p.moves < maxMoves);
}

function integer(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function validBlocks(value: unknown, dimensions: Position3): value is SavedBlock[] {
  const count = dimensions.x * dimensions.y * dimensions.z;
  if (!Array.isArray(value) || value.length > count) return false;
  const ids = new Set<number>();
  const positions = new Set<string>();
  for (const block of value) {
    if (!Array.isArray(block) || block.length !== 4 || !integer(block[0], 0, count - 1)
      || !integer(block[1], 0, dimensions.x - 1) || !integer(block[2], 0, dimensions.y - 1)
      || !integer(block[3], 0, dimensions.z - 1)) return false;
    const position = block.slice(1).join(":");
    if (ids.has(block[0]) || positions.has(position)) return false;
    ids.add(block[0]); positions.add(position);
  }
  return true;
}
