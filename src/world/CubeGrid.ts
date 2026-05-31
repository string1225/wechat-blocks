import * as THREE from "three";
import type { BlockSnapshot, GridSnapshot, LevelConfig, Position3 } from "../game/types";
import { createRng, pickOne } from "../systems/random";

export interface GridBlock {
  id: string;
  instanceId: number;
  grid: Position3;
  color: string;
  active: boolean;
  scale: number;
  current: THREE.Vector3;
  removing: boolean;
  removeT: number;
  fall:
    | {
        from: THREE.Vector3;
        to: THREE.Vector3;
        t: number;
      }
    | null;
}

export interface GridUpdateResult {
  changed: boolean;
  removed: number;
  startedFalls: number;
  animating: boolean;
}

const NEIGHBOR_OFFSETS: readonly Position3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
];

export class CubeGrid {
  readonly gap = 1.08;
  readonly size: number;
  readonly blocks: GridBlock[];

  private readonly positions = new Map<string, GridBlock>();

  constructor(level: LevelConfig) {
    this.size = level.size;
    this.blocks = this.createBlocks(level);
    this.rebuildPositionIndex();
  }

  get activeCount(): number {
    return this.blocks.reduce((total, block) => total + (block.active ? 1 : 0), 0);
  }

  get activeBlocks(): GridBlock[] {
    return this.blocks.filter((block) => block.active && !block.removing);
  }

  getBlockByInstanceId(instanceId: number): GridBlock | null {
    const block = this.blocks.find((item) => item.instanceId === instanceId);
    return block && block.active && !block.removing ? block : null;
  }

  getCluster(start: GridBlock): GridBlock[] {
    if (!start.active || start.removing) {
      return [];
    }

    const stack = [start];
    const visited = new Set<string>();
    const cluster: GridBlock[] = [];

    while (stack.length > 0) {
      const block = stack.pop();
      if (!block || visited.has(block.id)) {
        continue;
      }

      visited.add(block.id);
      cluster.push(block);

      for (const offset of NEIGHBOR_OFFSETS) {
        const next = this.getBlockAt({
          x: block.grid.x + offset.x,
          y: block.grid.y + offset.y,
          z: block.grid.z + offset.z
        });

        if (next && next.color === start.color && !visited.has(next.id)) {
          stack.push(next);
        }
      }
    }

    return cluster;
  }

  beginRemoval(blocks: readonly GridBlock[]): number {
    let count = 0;

    for (const block of blocks) {
      if (!block.active || block.removing) {
        continue;
      }

      block.removing = true;
      block.removeT = 0;
      count += 1;
    }

    return count;
  }

  update(dt: number): GridUpdateResult {
    let removed = 0;
    let startedFalls = 0;

    for (const block of this.blocks) {
      if (!block.removing) {
        continue;
      }

      block.removeT = Math.min(1, block.removeT + dt / 0.18);
      const eased = easeOutCubic(block.removeT);
      block.scale = Math.max(0.001, 1 - eased);
      block.current.y += dt * 0.55;

      if (block.removeT >= 1) {
        block.active = false;
        block.removing = false;
        block.scale = 0.001;
        removed += 1;
      }
    }

    if (removed > 0) {
      this.rebuildPositionIndex();
      startedFalls = this.applyGravity();
    }

    for (const block of this.blocks) {
      if (!block.fall) {
        continue;
      }

      block.fall.t = Math.min(1, block.fall.t + dt / 0.32);
      const eased = easeOutBack(block.fall.t);
      block.current.lerpVectors(block.fall.from, block.fall.to, eased);

      if (block.fall.t >= 1) {
        block.current.copy(block.fall.to);
        block.fall = null;
      }
    }

    const animating = this.isAnimating();

    return {
      changed: removed > 0 || startedFalls > 0,
      removed,
      startedFalls,
      animating
    };
  }

  isAnimating(): boolean {
    return this.blocks.some((block) => block.removing || block.fall !== null);
  }

  snapshot(): GridSnapshot {
    return {
      blocks: this.blocks.map((block) => ({
        id: block.id,
        instanceId: block.instanceId,
        grid: { ...block.grid },
        color: block.color,
        active: block.active
      }))
    };
  }

  restore(snapshot: GridSnapshot): void {
    const byInstance = new Map(snapshot.blocks.map((block) => [block.instanceId, block]));

    for (const block of this.blocks) {
      const saved = byInstance.get(block.instanceId);
      if (!saved) {
        block.active = false;
        block.scale = 0.001;
        block.removing = false;
        block.fall = null;
        continue;
      }

      block.grid = { ...saved.grid };
      block.color = saved.color;
      block.active = saved.active;
      block.scale = saved.active ? 1 : 0.001;
      block.removing = false;
      block.removeT = 0;
      block.fall = null;
      block.current.copy(this.toWorld(block.grid));
    }

    this.rebuildPositionIndex();
  }

  toWorld(position: Position3): THREE.Vector3 {
    const center = (this.size - 1) / 2;
    return new THREE.Vector3(
      (position.x - center) * this.gap,
      position.y * this.gap,
      (position.z - center) * this.gap
    );
  }

  private createBlocks(level: LevelConfig): GridBlock[] {
    const rng = createRng(level.seed);
    const blocks: GridBlock[] = [];
    let instanceId = 0;

    for (let x = 0; x < level.size; x += 1) {
      for (let y = 0; y < level.size; y += 1) {
        for (let z = 0; z < level.size; z += 1) {
          const grid = { x, y, z };
          const color = pickOne(level.palette, rng);
          blocks.push({
            id: `${x}:${y}:${z}`,
            instanceId,
            grid,
            color,
            active: true,
            scale: 1,
            current: this.toWorld(grid),
            removing: false,
            removeT: 0,
            fall: null
          });
          instanceId += 1;
        }
      }
    }

    return blocks;
  }

  private applyGravity(): number {
    let moved = 0;

    for (let x = 0; x < this.size; x += 1) {
      for (let z = 0; z < this.size; z += 1) {
        const column = this.blocks
          .filter((block) => block.active && block.grid.x === x && block.grid.z === z)
          .sort((a, b) => a.grid.y - b.grid.y);

        for (let y = 0; y < column.length; y += 1) {
          const block = column[y];
          if (!block || block.grid.y === y) {
            continue;
          }

          block.grid = { x, y, z };
          const target = this.toWorld(block.grid);
          block.fall = {
            from: block.current.clone(),
            to: target,
            t: 0
          };
          moved += 1;
        }
      }
    }

    this.rebuildPositionIndex();
    return moved;
  }

  private getBlockAt(position: Position3): GridBlock | null {
    return this.positions.get(positionKey(position)) ?? null;
  }

  private rebuildPositionIndex(): void {
    this.positions.clear();

    for (const block of this.blocks) {
      if (block.active && !block.removing) {
        this.positions.set(positionKey(block.grid), block);
      }
    }
  }
}

function positionKey(position: Position3): string {
  return `${position.x}:${position.y}:${position.z}`;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
