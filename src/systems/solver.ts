import type { CubeGrid, GridBlock } from "../world/CubeGrid";

export function chooseBestCluster(grid: CubeGrid): GridBlock[] {
  const visited = new Set<string>();
  let best: GridBlock[] = [];

  for (const block of grid.activeBlocks) {
    if (visited.has(block.id)) {
      continue;
    }

    const cluster = grid.getCluster(block);
    for (const item of cluster) {
      visited.add(item.id);
    }

    if (isBetterCluster(cluster, best)) {
      best = cluster;
    }
  }

  return best;
}

function isBetterCluster(candidate: readonly GridBlock[], current: readonly GridBlock[]): boolean {
  if (candidate.length !== current.length) {
    return candidate.length > current.length;
  }

  const candidateTop = Math.max(...candidate.map((block) => block.grid.y));
  const currentTop = current.length > 0 ? Math.max(...current.map((block) => block.grid.y)) : -1;
  if (candidateTop !== currentTop) {
    return candidateTop > currentTop;
  }

  const candidateCenterScore = candidate.reduce(
    (score, block) => score - Math.abs(block.grid.x) - Math.abs(block.grid.z),
    0
  );
  const currentCenterScore = current.reduce(
    (score, block) => score - Math.abs(block.grid.x) - Math.abs(block.grid.z),
    0
  );

  return candidateCenterScore > currentCenterScore;
}
