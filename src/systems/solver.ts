import type { CubeGrid, GridBlock } from "../world/CubeGrid";

export function chooseBestBlock(grid: CubeGrid): GridBlock | null {
  return (
    grid.activeBlocks
      .slice()
      .sort((a, b) => b.grid.y - a.grid.y || a.grid.x - b.grid.x || a.grid.z - b.grid.z)[0] ?? null
  );
}
