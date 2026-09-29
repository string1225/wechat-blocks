import * as THREE from "three";
import type { FaceArrow, GridSnapshot, LevelConfig, Position3 } from "../game/types";
import { createRng, pickOne } from "../systems/random";

export const BLOCK_SIZE = 0.82;
export const BLOCK_COLOR = "#4dfc59";

export interface GridBlock {
  id: string;
  instanceId: number;
  grid: Position3;
  color: string;
  faceArrows: FaceArrow[];
  active: boolean;
  scale: number;
  current: THREE.Vector3;
  flying: boolean;
  flight:
    | {
        exitBoard: boolean;
        finalGrid: Position3;
        from: THREE.Vector3;
        to: THREE.Vector3;
        t: number;
      }
    | null;
}

export interface GridUpdateResult {
  changed: boolean;
  finishedFlights: number;
  movedBlocks: number;
  animating: boolean;
}

const FACE_NORMALS: readonly Position3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
];

export class CubeGrid {
  readonly gap = BLOCK_SIZE;
  readonly size: number;
  readonly dimensions: Position3;
  readonly blocks: GridBlock[];

  private readonly positions = new Map<string, GridBlock>();

  constructor(level: LevelConfig) {
    this.size = level.size;
    this.dimensions = level.dimensions;
    this.blocks = this.createBlocks(level);
    this.rebuildPositionIndex();
  }

  get activeCount(): number {
    return this.blocks.reduce((total, block) => total + (block.active ? 1 : 0), 0);
  }

  get activeBlocks(): GridBlock[] {
    return this.blocks.filter((block) => block.active && !block.flying);
  }

  getBlockByInstanceId(instanceId: number): GridBlock | null {
    const block = this.blocks.find((item) => item.instanceId === instanceId);
    return block && block.active && !block.flying ? block : null;
  }

  getDirectionForFace(block: GridBlock, normal: Position3): Position3 {
    const arrow = block.faceArrows.find((item) => sameDirection(item.normal, normal));
    if (arrow) {
      return { ...arrow.direction };
    }

    const fallback = block.faceArrows[0];
    if (!fallback) {
      throw new Error(`Block ${block.id} has no flight direction.`);
    }

    return { ...fallback.direction };
  }

  beginFlight(block: GridBlock, direction: Position3): boolean {
    if (!block.active || block.flying) {
      return false;
    }

    const movement = this.resolveMovement(block, direction);
    if (!isResolvedMovementUseful(movement, block.grid)) {
      return false;
    }

    const from = block.current.clone();
    const to = movement.exitBoard
      ? from.clone().add(positionToVector(direction).multiplyScalar(this.size * this.gap + 3.4))
      : this.toWorld(movement.finalGrid);

    block.flying = true;
    block.flight = {
      exitBoard: movement.exitBoard,
      finalGrid: movement.finalGrid,
      from,
      to,
      t: 0
    };
    this.rebuildPositionIndex();
    return true;
  }

  canMove(block: GridBlock, direction: Position3): boolean {
    if (!block.active || block.flying) {
      return false;
    }

    return isResolvedMovementUseful(this.resolveMovement(block, direction), block.grid);
  }

  canExit(block: GridBlock, direction: Position3): boolean {
    if (!block.active || block.flying) {
      return false;
    }

    return this.resolveMovement(block, direction).exitBoard;
  }

  update(dt: number): GridUpdateResult {
    let finishedFlights = 0;
    let movedBlocks = 0;

    for (const block of this.blocks) {
      if (!block.flight) {
        continue;
      }

      block.flight.t = Math.min(1, block.flight.t + dt / (block.flight.exitBoard ? 0.48 : 0.25));
      const eased = block.flight.exitBoard ? easeInCubic(block.flight.t) : easeOutCubic(block.flight.t);
      block.current.lerpVectors(block.flight.from, block.flight.to, eased);
      block.scale = block.flight.exitBoard ? Math.max(0.001, 1 - eased * 0.18) : 1;

      if (block.flight.t >= 1) {
        const flight = block.flight;
        block.active = !flight.exitBoard;
        block.flying = false;
        block.flight = null;
        block.grid = { ...flight.finalGrid };
        block.current.copy(flight.exitBoard ? block.current : this.toWorld(block.grid));
        block.scale = flight.exitBoard ? 0.001 : 1;
        finishedFlights += 1;
        if (!flight.exitBoard) {
          movedBlocks += 1;
        }
      }
    }

    if (finishedFlights > 0) {
      this.rebuildPositionIndex();
    }

    const animating = this.isAnimating();

    return {
      changed: finishedFlights > 0,
      finishedFlights,
      movedBlocks,
      animating
    };
  }

  isAnimating(): boolean {
    return this.blocks.some((block) => block.flight !== null);
  }

  snapshot(): GridSnapshot {
    return {
      blocks: this.blocks.map((block) => ({
        id: block.id,
        instanceId: block.instanceId,
        grid: { ...block.grid },
        color: block.color,
        faceArrows: block.faceArrows.map((arrow) => ({
          normal: { ...arrow.normal },
          direction: { ...arrow.direction }
        })),
        active: block.active
      }))
    };
  }

  removeBlock(block: GridBlock): boolean {
    if (!block.active || block.flying) return false;
    block.active = false;
    block.scale = 0;
    block.flight = null;
    this.rebuildPositionIndex();
    return true;
  }

  settledSnapshot(): GridSnapshot {
    const snapshot = this.snapshot();
    for (const saved of snapshot.blocks) {
      const flight = this.blocks[saved.instanceId]?.flight;
      if (flight) {
        saved.active = !flight.exitBoard;
        saved.grid = { ...flight.finalGrid };
      }
    }
    return snapshot;
  }

  restore(snapshot: GridSnapshot): void {
    const byInstance = new Map(snapshot.blocks.map((block) => [block.instanceId, block]));

    for (const block of this.blocks) {
      const saved = byInstance.get(block.instanceId);
      if (!saved) {
        block.active = false;
        block.scale = 0.001;
        block.flying = false;
        block.flight = null;
        continue;
      }

      block.grid = { ...saved.grid };
      block.color = saved.color;
      block.faceArrows = saved.faceArrows.map((arrow) => ({
        normal: { ...arrow.normal },
        direction: { ...arrow.direction }
      }));
      block.active = saved.active;
      block.scale = saved.active ? 1 : 0.001;
      block.flying = false;
      block.flight = null;
      block.current.copy(this.toWorld(block.grid));
    }

    this.rebuildPositionIndex();
  }

  toWorld(position: Position3): THREE.Vector3 {
    return new THREE.Vector3(
      (position.x - (this.dimensions.x - 1) / 2) * this.gap,
      position.y * this.gap,
      (position.z - (this.dimensions.z - 1) / 2) * this.gap
    );
  }

  private createBlocks(level: LevelConfig): GridBlock[] {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const rng = createRng(level.seed + attempt * 7919);
      const arrowsByPosition = level.layoutVersion === 1
        ? createSolvableFaceArrowMap(level.size, rng)
        : createGrowingArrowMap(this.dimensions, rng);
      const blocks: GridBlock[] = [];
      let instanceId = 0;

      for (let x = 0; x < this.dimensions.x; x += 1) {
        for (let y = 0; y < this.dimensions.y; y += 1) {
          for (let z = 0; z < this.dimensions.z; z += 1) {
            const grid = { x, y, z };
            const faceArrows = arrowsByPosition.get(positionKey(grid));
            if (!faceArrows) {
              throw new Error(`Missing generated arrows for ${positionKey(grid)}.`);
            }

            blocks.push({
              id: `${x}:${y}:${z}`,
              instanceId,
              grid,
              color: BLOCK_COLOR,
              faceArrows,
              active: true,
              scale: 1,
              current: this.toWorld(grid),
              flying: false,
              flight: null
            });
            instanceId += 1;
          }
        }
      }

      if (level.layoutVersion === 2 || validateSolvable(blocks, level.size)) {
        return blocks;
      }
    }

    throw new Error(`Unable to generate a solvable ${level.size}x${level.size}x${level.size} level.`);
  }

  private getBlockAt(position: Position3): GridBlock | null {
    return this.positions.get(positionKey(position)) ?? null;
  }

  private resolveMovement(block: GridBlock, direction: Position3): { exitBoard: boolean; finalGrid: Position3 } {
    const step = normalizeGridDirection(direction);
    let cursor = addPosition(block.grid, step);
    let finalGrid = { ...block.grid };

    while (this.isInside(cursor)) {
      if (this.getBlockAt(cursor)) {
        return {
          exitBoard: false,
          finalGrid
        };
      }

      finalGrid = { ...cursor };
      cursor = addPosition(cursor, step);
    }

    return {
      exitBoard: true,
      finalGrid
    };
  }

  private isInside(position: Position3): boolean {
    return (
      position.x >= 0 &&
      position.x < this.dimensions.x &&
      position.y >= 0 &&
      position.y < this.dimensions.y &&
      position.z >= 0 &&
      position.z < this.dimensions.z
    );
  }

  private rebuildPositionIndex(): void {
    this.positions.clear();

    for (const block of this.blocks) {
      if (!block.active || block.flight?.exitBoard) continue;
      // A sliding block reserves its destination immediately. Following taps
      // can use vacated cells without ever landing inside another moving block.
      this.positions.set(positionKey(block.flight?.finalGrid ?? block.grid), block);
    }
  }
}

function positionKey(position: Position3): string {
  return `${position.x}:${position.y}:${position.z}`;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function dot(a: Position3, b: Position3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sameDirection(a: Position3, b: Position3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function samePosition(a: Position3, b: Position3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function isResolvedMovementUseful(
  movement: { exitBoard: boolean; finalGrid: Position3 },
  start: Position3
): boolean {
  return movement.exitBoard || !samePosition(movement.finalGrid, start);
}

function addPosition(a: Position3, b: Position3): Position3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z
  };
}

function normalizeGridDirection(position: Position3): Position3 {
  return {
    x: Math.sign(position.x),
    y: Math.sign(position.y),
    z: Math.sign(position.z)
  };
}

function positionToVector(position: Position3): THREE.Vector3 {
  return new THREE.Vector3(position.x, position.y, position.z).normalize();
}

function createGrowingArrowMap(dimensions: Position3, rng: () => number): Map<string, FaceArrow[]> {
  const { x: width, y: height, z: depth } = dimensions;
  const count = width * height * depth;
  const occupied = new Uint8Array(count).fill(1), masks = new Uint8Array(count);
  const positions: Position3[] = [], candidates: number[] = [];
  const arrows = new Map<string, FaceArrow[]>();
  const index = (p: Position3): number => (p.x * height + p.y) * depth + p.z;
  const inside = (p: Position3): boolean => p.x >= 0 && p.x < width && p.y >= 0 && p.y < height && p.z >= 0 && p.z < depth;
  const expose = (id: number, direction: number): void => {
    if (occupied[id] && !(masks[id]! & (1 << direction))) {
      masks[id]! |= 1 << direction;
      candidates.push(id * 6 + direction);
    }
  };
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) for (let z = 0; z < depth; z++) {
    const position = { x, y, z }, id = index(position);
    positions.push(position);
    FACE_NORMALS.forEach((direction, d) => { if (!inside(addPosition(position, direction))) expose(id, d); });
  }
  // Remove a random block whose arrow already has a clear ray out. Newly
  // exposed rays are queued once, giving a constructive solution without
  // rescanning every occupied cell for every removal on large boards.
  while (candidates.length) {
    const choice = Math.floor(rng() * candidates.length), encoded = candidates[choice]!;
    candidates[choice] = candidates[candidates.length - 1]!; candidates.pop();
    const id = Math.floor(encoded / 6);
    if (!occupied[id]) continue;
    occupied[id] = 0;
    const position = positions[id]!, direction = FACE_NORMALS[encoded % 6]!;
    arrows.set(positionKey(position), FACE_NORMALS.filter(normal => dot(normal, direction) === 0)
      .map(normal => ({ normal: { ...normal }, direction: { ...direction } })));
    FACE_NORMALS.forEach((outward, d) => {
      if (!(masks[id]! & (1 << d))) return;
      const inward = { x: -outward.x, y: -outward.y, z: -outward.z };
      let cursor = addPosition(position, inward);
      while (inside(cursor)) {
        const next = index(cursor);
        if (occupied[next]) { expose(next, d); break; }
        cursor = addPosition(cursor, inward);
      }
    });
  }
  if (arrows.size !== count) throw new Error("Generated arrow graph is incomplete.");
  return arrows;
}

function createSolvableFaceArrowMap(size: number, rng: () => number): Map<string, FaceArrow[]> {
  const occupied = new Set<string>();
  const assigned = new Map<string, FaceArrow>();

  for (const position of allPositions(size)) {
    occupied.add(positionKey(position));
  }

  while (occupied.size > 0) {
    const choices: Array<{ direction: Position3; normal: Position3; position: Position3 }> = [];

    for (const key of occupied) {
      const position = parsePositionKey(key);

      for (const normal of shuffled(FACE_NORMALS, rng)) {
        if (!isFaceExposed(position, normal, occupied, size)) {
          continue;
        }

        for (const direction of shuffled(FACE_NORMALS, rng)) {
          if (dot(normal, direction) !== 0 || !hasClearPathToOutside(position, direction, occupied, size)) {
            continue;
          }

          choices.push({
            direction: { ...direction },
            normal: { ...normal },
            position
          });
        }
      }
    }

    if (choices.length === 0) {
      throw new Error("Generated arrow graph is deadlocked.");
    }

    const choice = pickOne(choices, rng);
    assigned.set(positionKey(choice.position), {
      normal: choice.normal,
      direction: choice.direction
    });
    occupied.delete(positionKey(choice.position));
  }

  const arrowsByPosition = new Map<string, FaceArrow[]>();
  for (const position of allPositions(size)) {
    const key = positionKey(position);
    const guaranteed = assigned.get(key);
    if (!guaranteed) {
      throw new Error(`Missing guaranteed arrow for ${key}.`);
    }

    const direction = { ...guaranteed.direction };
    const arrows = FACE_NORMALS.filter((normal) => dot(normal, direction) === 0).map((normal) => ({
      normal: { ...normal },
      direction: { ...direction }
    }));

    arrowsByPosition.set(key, arrows);
  }

  return arrowsByPosition;
}

function validateSolvable(blocks: readonly GridBlock[], size: number): boolean {
  const occupied = new Set(blocks.filter((block) => block.active).map((block) => positionKey(block.grid)));
  const arrowsByPosition = new Map(blocks.map((block) => [positionKey(block.grid), block.faceArrows]));

  while (occupied.size > 0) {
    let removedKey: string | null = null;

    for (const key of occupied) {
      const position = parsePositionKey(key);
      const arrows = arrowsByPosition.get(key);
      if (arrows && isRemovableByArrows(position, arrows, occupied, size)) {
        removedKey = key;
        break;
      }
    }

    if (!removedKey) {
      return false;
    }

    occupied.delete(removedKey);
  }

  return true;
}

function isRemovableByArrows(
  position: Position3,
  arrows: readonly FaceArrow[],
  occupied: ReadonlySet<string>,
  size: number
): boolean {
  return arrows.some(
    (arrow) =>
      dot(arrow.normal, arrow.direction) === 0 &&
      isFaceExposed(position, arrow.normal, occupied, size) &&
      hasClearPathToOutside(position, arrow.direction, occupied, size)
  );
}

function hasClearPathToOutside(
  position: Position3,
  direction: Position3,
  occupied: ReadonlySet<string>,
  size: number
): boolean {
  let cursor = addPosition(position, direction);

  while (isInsidePosition(cursor, size)) {
    if (occupied.has(positionKey(cursor))) {
      return false;
    }
    cursor = addPosition(cursor, direction);
  }

  return true;
}

function isFaceExposed(
  position: Position3,
  normal: Position3,
  occupied: ReadonlySet<string>,
  size: number
): boolean {
  const neighbor = addPosition(position, normal);
  return !isInsidePosition(neighbor, size) || !occupied.has(positionKey(neighbor));
}

function isInsidePosition(position: Position3, size: number): boolean {
  return (
    position.x >= 0 &&
    position.x < size &&
    position.y >= 0 &&
    position.y < size &&
    position.z >= 0 &&
    position.z < size
  );
}

function allPositions(size: number): Position3[] {
  const positions: Position3[] = [];
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let z = 0; z < size; z += 1) {
        positions.push({ x, y, z });
      }
    }
  }
  return positions;
}

function parsePositionKey(key: string): Position3 {
  const [x = "0", y = "0", z = "0"] = key.split(":");
  return {
    x: Number(x),
    y: Number(y),
    z: Number(z)
  };
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = copy[index]!;
    copy[index] = copy[swapIndex]!;
    copy[swapIndex] = current;
  }
  return copy;
}
