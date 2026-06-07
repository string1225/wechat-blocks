import type { LevelConfig } from "../game/types";

export const LEVEL_COUNT = 10;

const PALETTES: readonly (readonly string[])[] = [
  ["#1f9a77", "#e85d4f", "#f0b43c", "#4f8fd8", "#7b62d9"],
  ["#2e6f95", "#f07167", "#ffd166", "#06a77d", "#8e7dbe"],
  ["#167a75", "#d94f70", "#f2a65a", "#4f7cac", "#6a994e"]
];

const FALLBACK_PALETTE = PALETTES[0]!;

export function getLevelConfig(levelId: number): LevelConfig {
  const id = Math.max(1, Math.min(LEVEL_COUNT, levelId));
  const size = id <= 3 ? 4 : id <= 7 ? 5 : 6;
  const blockCount = size * size * size;
  const bestGuess = blockCount;
  const maxMoves = blockCount + 8;
  const palette = PALETTES[(id - 1) % PALETTES.length] ?? FALLBACK_PALETTE;

  return {
    id,
    name: `Level ${id}`,
    size,
    maxMoves,
    starThresholds: [bestGuess, bestGuess + 3, maxMoves],
    seed: 20260517 + id * 977,
    palette
  };
}
