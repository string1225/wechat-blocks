import * as THREE from "three";
import type { Position3 } from "./types";
import { BLOCK_COLOR, BLOCK_SIZE, type GridBlock } from "../world/CubeGrid";

export interface PickResult {
  instanceId: number;
  faceNormal: Position3;
}

const ARROW_STROKE_WIDTH = 0.036;
const FACE_BORDER_WIDTH = 0.014;
const FACE_OFFSET = 0.014;
const FACE_NORMALS: readonly Position3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
];

export class GameScene {
  readonly camera: THREE.PerspectiveCamera;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly raycaster = new THREE.Raycaster();
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly pointer = new THREE.Vector2();
  private readonly target = new THREE.Vector3();
  private readonly arrowGeometry = createArrowStrokeGeometry();
  private readonly arrowMaterial = new THREE.MeshBasicMaterial({
    color: 0x102717,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  private readonly faceBorderGeometry = createFaceBorderGeometry();
  private readonly faceBorderMaterial = new THREE.MeshBasicMaterial({
    color: 0x122a17,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  private readonly blankFaceGeometry = new THREE.PlaneGeometry(BLOCK_SIZE * 0.9, BLOCK_SIZE * 0.9);
  private readonly blankFaceMaterial = new THREE.MeshBasicMaterial({
    color: 0x102717,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  private readonly arrowMatrix = new THREE.Matrix4();
  private readonly arrowXAxis = new THREE.Vector3();
  private readonly arrowYAxis = new THREE.Vector3();
  private readonly arrowZAxis = new THREE.Vector3();
  private readonly faceMatrix = new THREE.Matrix4();
  private readonly faceXAxis = new THREE.Vector3();
  private readonly faceYAxis = new THREE.Vector3();
  private readonly faceZAxis = new THREE.Vector3();
  private readonly overlayPosition = new THREE.Vector3();
  private readonly overlayScale = new THREE.Vector3();
  private readonly overlayQuaternion = new THREE.Quaternion();
  private arrowOverlays: Array<{
    block: GridBlock;
    direction: THREE.Vector3;
    index: number;
    normal: THREE.Vector3;
  }> = [];
  private faceBorderOverlays: Array<{ block: GridBlock; index: number; normal: Position3 }> = [];
  private blankFaceOverlays: Array<{ block: GridBlock; index: number; normal: Position3 }> = [];
  private arrowMesh: THREE.InstancedMesh | null = null;
  private faceBorderMesh: THREE.InstancedMesh | null = null;
  private blankFaceMesh: THREE.InstancedMesh | null = null;
  private mesh: THREE.InstancedMesh | null = null;
  private theta = Math.PI * 0.22;
  private phi = Math.PI * 0.34;
  private activeSize = 4;
  private zoomFactor = 1;
  private baseRadius = 7;
  private radius = 7;
  private minRadius = 4;
  private maxRadius = 14;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xeef4ef, 1);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.scene.background = new THREE.Color(0xeef4ef);

    this.createLighting();
    this.createStage();
    this.resize();
  }

  loadBlocks(blocks: readonly GridBlock[], size: number): void {
    this.clearBlockOverlays();

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (Array.isArray(this.mesh.material)) {
        for (const material of this.mesh.material) {
          material.dispose();
        }
      } else {
        this.mesh.material.dispose();
      }
      this.mesh = null;
    }

    const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    const material = new THREE.MeshBasicMaterial({
      color: blocks[0]?.color ?? BLOCK_COLOR
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, blocks.length));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    this.scene.add(this.mesh);
    this.createBlockOverlays(blocks);

    this.activeSize = size;
    this.target.set(0, ((size - 1) * BLOCK_SIZE) / 2, 0);
    this.zoomFactor = 1;
    this.frameActiveBlocks();
    this.updateBlocks(blocks);
  }

  updateBlocks(blocks: readonly GridBlock[]): void {
    if (!this.mesh) {
      return;
    }

    for (const block of blocks) {
      this.scale.setScalar(block.active ? block.scale : 0.001);
      this.matrix.compose(block.current, this.rotation, this.scale);
      this.mesh.setMatrixAt(block.instanceId, this.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;

    this.updateBlockOverlays(blocks);
  }

  pickBlock(clientX: number, clientY: number): PickResult | null {
    if (!this.mesh) {
      return null;
    }

    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.pointer.y = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObject(this.mesh, false);
    const hit = hits.find((item) => item.instanceId !== undefined);
    if (!hit || hit.instanceId === undefined || !hit.face) {
      return null;
    }

    return {
      instanceId: hit.instanceId,
      faceNormal: dominantAxis(hit.face.normal)
    };
  }

  rotate(deltaX: number, deltaY: number): void {
    this.theta -= deltaX * 0.006;
    this.phi = THREE.MathUtils.clamp(this.phi - deltaY * 0.005, 0.22, Math.PI * 0.48);
    this.updateCamera();
  }

  zoom(delta: number): void {
    this.zoomFactor = THREE.MathUtils.clamp(this.zoomFactor * delta, 0.55, 1.85);
    this.radius = THREE.MathUtils.clamp(this.baseRadius * this.zoomFactor, this.minRadius, this.maxRadius);
    this.updateCamera();
  }

  resize(): void {
    const width = this.canvas.clientWidth || globalThis.innerWidth || 1;
    const height = this.canvas.clientHeight || globalThis.innerHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.frameActiveBlocks(false);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  samplePixels(): { height: number; nonBackground: number; uniqueColors: number; width: number } {
    const gl = this.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixel = new Uint8Array(4);
    const colors = new Set<string>();
    let nonBackground = 0;
    const samples = 13;

    for (let ix = 0; ix < samples; ix += 1) {
      for (let iy = 0; iy < samples; iy += 1) {
        const x = Math.max(0, Math.min(width - 1, Math.round(((ix + 0.5) * width) / samples)));
        const y = Math.max(0, Math.min(height - 1, Math.round(((iy + 0.5) * height) / samples)));
        gl.readPixels(x, height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const red = pixel[0] ?? 0;
        const green = pixel[1] ?? 0;
        const blue = pixel[2] ?? 0;
        const alpha = pixel[3] ?? 0;
        colors.add(`${red},${green},${blue},${alpha}`);

        const distanceFromBackground =
          Math.abs(red - 238) + Math.abs(green - 244) + Math.abs(blue - 239);
        if (distanceFromBackground > 24) {
          nonBackground += 1;
        }
      }
    }

    return {
      height,
      nonBackground,
      uniqueColors: colors.size,
      width
    };
  }

  private updateCamera(): void {
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinPhi * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }

  private frameActiveBlocks(resetZoom = true): void {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(0.55, this.camera.aspect || 1);
    const desiredWidthFill = 0.7;
    const diagonalWidth = this.activeSize * BLOCK_SIZE * 1.38;
    this.baseRadius = diagonalWidth / (2 * Math.tan(fov / 2) * aspect * desiredWidthFill);
    this.minRadius = Math.max(2.2, this.baseRadius * 0.55);
    this.maxRadius = Math.max(this.baseRadius * 2.2, this.minRadius + 1);
    if (resetZoom) {
      this.zoomFactor = 1;
    }
    this.radius = THREE.MathUtils.clamp(this.baseRadius * this.zoomFactor, this.minRadius, this.maxRadius);
    this.updateCamera();
  }

  private createLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x4c5a82, 2.2);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(4, 7, 5);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8cc7ff, 0.86);
    fill.position.set(-5, 4, -4);
    this.scene.add(fill);
  }

  private createStage(): void {
    this.scene.background = new THREE.Color(0x282d58);
    this.renderer.setClearColor(0x282d58, 1);

    const grid = new THREE.GridHelper(10, 12, 0x54609a, 0x39406d);
    grid.position.y = -0.56;
    const material = grid.material;
    if (Array.isArray(material)) {
      for (const item of material) {
        item.transparent = true;
        item.opacity = 0.36;
      }
    } else {
      material.transparent = true;
      material.opacity = 0.22;
    }
    this.scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(5.4, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.58;
    this.scene.add(floor);
  }

  private createBlockOverlays(blocks: readonly GridBlock[]): void {
    this.arrowOverlays = [];
    this.faceBorderOverlays = [];
    this.blankFaceOverlays = [];

    for (const block of blocks) {
      for (const normal of FACE_NORMALS) {
        this.faceBorderOverlays.push({
          block,
          index: this.faceBorderOverlays.length,
          normal
        });
      }

      for (const normal of getBlankFaceNormals(block)) {
        this.blankFaceOverlays.push({
          block,
          index: this.blankFaceOverlays.length,
          normal
        });
      }

      for (const arrow of block.faceArrows) {
        this.arrowOverlays.push({
          block,
          direction: positionToVector(arrow.direction),
          index: this.arrowOverlays.length,
          normal: positionToVector(arrow.normal)
        });
      }
    }

    this.faceBorderMesh = new THREE.InstancedMesh(
      this.faceBorderGeometry,
      this.faceBorderMaterial,
      Math.max(1, this.faceBorderOverlays.length)
    );
    this.faceBorderMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.faceBorderMesh.renderOrder = 2;
    this.scene.add(this.faceBorderMesh);

    this.blankFaceMesh = new THREE.InstancedMesh(
      this.blankFaceGeometry,
      this.blankFaceMaterial,
      Math.max(1, this.blankFaceOverlays.length)
    );
    this.blankFaceMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blankFaceMesh.renderOrder = 2;
    this.scene.add(this.blankFaceMesh);

    this.arrowMesh = new THREE.InstancedMesh(
      this.arrowGeometry,
      this.arrowMaterial,
      Math.max(1, this.arrowOverlays.length)
    );
    this.arrowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrowMesh.renderOrder = 3;
    this.scene.add(this.arrowMesh);
  }

  private clearBlockOverlays(): void {
    if (this.faceBorderMesh) {
      this.scene.remove(this.faceBorderMesh);
      this.faceBorderMesh.dispose();
      this.faceBorderMesh = null;
    }

    if (this.blankFaceMesh) {
      this.scene.remove(this.blankFaceMesh);
      this.blankFaceMesh.dispose();
      this.blankFaceMesh = null;
    }

    if (this.arrowMesh) {
      this.scene.remove(this.arrowMesh);
      this.arrowMesh.dispose();
      this.arrowMesh = null;
    }

    this.faceBorderOverlays = [];
    this.blankFaceOverlays = [];
    this.arrowOverlays = [];
  }

  private updateBlockOverlays(blocks: readonly GridBlock[]): void {
    const occupied = new Set(
      blocks.filter((block) => block.active && !block.flying).map((block) => positionKey(block.grid))
    );

    if (this.faceBorderMesh) {
      for (const item of this.faceBorderOverlays) {
        const visible = item.block.active && isFaceExposed(item.block, item.normal, occupied, this.activeSize);
        this.setFaceOverlayMatrix(this.faceBorderMesh, item.index, item.block, item.normal, visible, FACE_OFFSET);
      }
      this.faceBorderMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.blankFaceMesh) {
      for (const item of this.blankFaceOverlays) {
        const visible = item.block.active && isFaceExposed(item.block, item.normal, occupied, this.activeSize);
        this.setFaceOverlayMatrix(this.blankFaceMesh, item.index, item.block, item.normal, visible, FACE_OFFSET * 1.2);
      }
      this.blankFaceMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.arrowMesh) {
      for (const item of this.arrowOverlays) {
        const visible =
          item.block.active && isFaceExposed(item.block, vectorToPosition(item.normal), occupied, this.activeSize);
        this.setArrowOverlayMatrix(this.arrowMesh, item.index, item, visible);
      }
      this.arrowMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private setFaceOverlayMatrix(
    mesh: THREE.InstancedMesh,
    index: number,
    block: GridBlock,
    normal: Position3,
    visible: boolean,
    offset: number
  ): void {
    const normalVector = positionToVector(normal);
    this.overlayPosition.copy(block.current).addScaledVector(normalVector, (BLOCK_SIZE / 2) * block.scale + offset);
    this.faceZAxis.copy(normalVector);
    const reference = Math.abs(this.faceZAxis.y) > 0.8 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    this.faceXAxis.crossVectors(reference, this.faceZAxis).normalize();
    this.faceYAxis.crossVectors(this.faceZAxis, this.faceXAxis).normalize();
    this.faceMatrix.makeBasis(this.faceXAxis, this.faceYAxis, this.faceZAxis);
    this.overlayQuaternion.setFromRotationMatrix(this.faceMatrix);
    this.overlayScale.setScalar(visible ? block.scale : 0.001);
    this.matrix.compose(this.overlayPosition, this.overlayQuaternion, this.overlayScale);
    mesh.setMatrixAt(index, this.matrix);
  }

  private setArrowOverlayMatrix(
    mesh: THREE.InstancedMesh,
    index: number,
    item: { block: GridBlock; direction: THREE.Vector3; normal: THREE.Vector3 },
    visible: boolean
  ): void {
    this.overlayPosition
      .copy(item.block.current)
      .addScaledVector(item.normal, (BLOCK_SIZE / 2) * item.block.scale + FACE_OFFSET * 1.4);
    this.arrowYAxis.copy(item.direction).normalize();
    this.arrowZAxis.copy(item.normal).normalize();
    this.arrowXAxis.crossVectors(this.arrowYAxis, this.arrowZAxis).normalize();
    this.arrowMatrix.makeBasis(this.arrowXAxis, this.arrowYAxis, this.arrowZAxis);
    this.overlayQuaternion.setFromRotationMatrix(this.arrowMatrix);
    this.overlayScale.setScalar(visible ? item.block.scale : 0.001);
    this.matrix.compose(this.overlayPosition, this.overlayQuaternion, this.overlayScale);
    mesh.setMatrixAt(index, this.matrix);
  }
}

function createArrowStrokeGeometry(): THREE.BufferGeometry {
  return createStrokeGeometry([
    [new THREE.Vector2(0, -0.28), new THREE.Vector2(0, 0.22)],
    [new THREE.Vector2(0, 0.22), new THREE.Vector2(-0.16, 0.06)],
    [new THREE.Vector2(0, 0.22), new THREE.Vector2(0.16, 0.06)]
  ], ARROW_STROKE_WIDTH);
}

function createFaceBorderGeometry(): THREE.BufferGeometry {
  const half = BLOCK_SIZE / 2;
  return createStrokeGeometry([
    [new THREE.Vector2(-half, -half), new THREE.Vector2(half, -half)],
    [new THREE.Vector2(half, -half), new THREE.Vector2(half, half)],
    [new THREE.Vector2(half, half), new THREE.Vector2(-half, half)],
    [new THREE.Vector2(-half, half), new THREE.Vector2(-half, -half)]
  ], FACE_BORDER_WIDTH);
}

function createStrokeGeometry(segments: Array<[THREE.Vector2, THREE.Vector2]>, width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const halfWidth = width / 2;

  for (const [start, end] of segments) {
    const delta = end.clone().sub(start);
    if (delta.lengthSq() === 0) {
      continue;
    }
    const perpendicular = new THREE.Vector2(-delta.y, delta.x).normalize().multiplyScalar(halfWidth);
    const a = start.clone().add(perpendicular);
    const b = start.clone().sub(perpendicular);
    const c = end.clone().add(perpendicular);
    const d = end.clone().sub(perpendicular);

    positions.push(
      a.x, a.y, 0,
      b.x, b.y, 0,
      c.x, c.y, 0,
      c.x, c.y, 0,
      b.x, b.y, 0,
      d.x, d.y, 0
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function getBlankFaceNormals(block: GridBlock): Position3[] {
  const direction = block.faceArrows[0]?.direction;
  if (!direction) {
    return [];
  }

  return FACE_NORMALS.filter((normal) => Math.abs(dot(normal, direction)) === 1);
}

function isFaceExposed(
  block: GridBlock,
  normal: Position3,
  occupied: ReadonlySet<string>,
  size: number
): boolean {
  if (block.flying) {
    return true;
  }

  const neighbor = addPosition(block.grid, normal);
  return !isInsidePosition(neighbor, size) || !occupied.has(positionKey(neighbor));
}

function addPosition(a: Position3, b: Position3): Position3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z
  };
}

function positionKey(position: Position3): string {
  return `${position.x}:${position.y}:${position.z}`;
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

function dot(a: Position3, b: Position3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vectorToPosition(vector: THREE.Vector3): Position3 {
  return {
    x: Math.round(vector.x),
    y: Math.round(vector.y),
    z: Math.round(vector.z)
  };
}

function dominantAxis(vector: THREE.Vector3): Position3 {
  const absX = Math.abs(vector.x);
  const absY = Math.abs(vector.y);
  const absZ = Math.abs(vector.z);

  if (absX >= absY && absX >= absZ) {
    return { x: Math.sign(vector.x) || 1, y: 0, z: 0 };
  }
  if (absY >= absX && absY >= absZ) {
    return { x: 0, y: Math.sign(vector.y) || 1, z: 0 };
  }
  return { x: 0, y: 0, z: Math.sign(vector.z) || 1 };
}

function positionToVector(position: Position3): THREE.Vector3 {
  return new THREE.Vector3(position.x, position.y, position.z).normalize();
}
