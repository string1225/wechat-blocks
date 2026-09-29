import type { LevelConfig } from "../game/types";

const PALETTES: readonly (readonly string[])[] = [
  ["#1f9a77", "#e85d4f", "#f0b43c", "#4f8fd8", "#7b62d9"],
  ["#2e6f95", "#f07167", "#ffd166", "#06a77d", "#8e7dbe"],
  ["#167a75", "#d94f70", "#f2a65a", "#4f7cac", "#6a994e"]
];

const FALLBACK_PALETTE = PALETTES[0]!;

export function getLevelDimensions(levelId: number, version: 2 | 3 = 3): { x: number; y: number; z: number } {
  if (version === 3 && levelId > 100) {
    const increments = 1 + Math.floor((levelId - 101) / 10);
    const edge = 9 + Math.floor(increments / 3), steps = increments % 3;
    return { x: edge + Number(steps >= 1), y: edge, z: edge + Number(steps >= 2) };
  }
  let remaining = levelId - 1, edge = 4, interval = 1;
  // Grow length, width, then height. Each complete cycle doubles the
  // interval so the board grows gradually even far beyond level ten.
  while (remaining >= 3 * interval) {
    remaining -= 3 * interval;
    edge += 1;
    interval *= 2;
  }
  const steps = Math.floor(remaining / interval);
  return { x: edge + (steps >= 1 ? 1 : 0), y: edge, z: edge + (steps >= 2 ? 1 : 0) };
}

export function getLevelConfig(levelId: number, layoutVersion: 1 | 2 | 3 = 3): LevelConfig {
  const id = Number.isSafeInteger(levelId) && levelId >= 1 ? levelId : 1;
  const oldSize = id <= 3 ? 4 : id <= 7 ? 5 : 6;
  const dimensions = layoutVersion === 1 ? { x: oldSize, y: oldSize, z: oldSize } : getLevelDimensions(id, layoutVersion);
  const size = Math.max(dimensions.x, dimensions.y, dimensions.z);
  const blockCount = dimensions.x * dimensions.y * dimensions.z;
  const bestGuess = blockCount;
  const maxMoves = blockCount + 8;
  const palette = PALETTES[(id - 1) % PALETTES.length] ?? FALLBACK_PALETTE;

  return {
    id,
    name: `Level ${id}`,
    size,
    dimensions,
    layoutVersion,
    maxMoves,
    starThresholds: [bestGuess, bestGuess + 3, maxMoves],
    seed: 20260517 + id * 977,
    palette
  };
}
