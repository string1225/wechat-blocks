import { LEVEL_COUNT } from "../data/levels";
import type { GamePhase, GridSnapshot, PowerupState } from "../game/types";

export type SavedBlock = [number, number, number, number];
export interface SavedTurn { blocks: SavedBlock[]; moves: number }
export interface GameProgress extends SavedTurn {
  version: 1;
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
  if (p.version !== 1 || !integer(p.level, 1, LEVEL_COUNT)) return false;
  const size = p.level <= 3 ? 4 : p.level <= 7 ? 5 : 6;
  const maxMoves = size ** 3 + 8;
  if (!integer(p.moves, 0, maxMoves) || !["playing", "won", "failed"].includes(p.phase)) return false;
  if (!p.powerups || !integer(p.powerups.undo, 0, 5) || !integer(p.powerups.bomb, 0, 3)) return false;
  if (!validBlocks(p.blocks, size) || !Array.isArray(p.history) || p.history.length > 30) return false;
  if (!p.history.every((turn) => turn && integer(turn.moves, 0, p.moves - 1) && validBlocks(turn.blocks, size))) return false;
  if (p.phase === "won") return p.blocks.length === 0;
  return p.blocks.length > 0 && (p.phase === "failed" ? p.moves >= maxMoves : p.moves < maxMoves);
}

function integer(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function validBlocks(value: unknown, size: number): value is SavedBlock[] {
  if (!Array.isArray(value) || value.length > size ** 3) return false;
  const ids = new Set<number>();
  const positions = new Set<string>();
  for (const block of value) {
    if (!Array.isArray(block) || block.length !== 4 || !integer(block[0], 0, size ** 3 - 1)
      || !block.slice(1).every((n) => integer(n, 0, size - 1))) return false;
    const position = block.slice(1).join(":");
    if (ids.has(block[0]) || positions.has(position)) return false;
    ids.add(block[0]); positions.add(position);
  }
  return true;
}
