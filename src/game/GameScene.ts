import * as THREE from "three";
import type { Position3 } from "./types";
import { getDevicePixelRatio, getHudInsets } from "../platform/display";
import type { UiState } from "../ui/GameUi";
import { SceneHud, type SceneHudAction } from "../ui/SceneHud";
import { BLOCK_SIZE, type GridBlock } from "../world/CubeGrid";
import { createBlockMaterials } from "./blockMaterials";

export interface PickResult { instanceId: number; faceNormal: Position3 }
export interface GameSceneOptions { sceneHud?: boolean }

export class GameScene {
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly stage = new THREE.Group();
  private readonly hud: SceneHud | null;
  private hudState: UiState | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly warningColor = new THREE.Color("#ffb33f");
  private readonly localForward = new THREE.Vector3(0, 1, 0);
  private readonly direction = new THREE.Vector3();
  private readonly faceDirection = new THREE.Vector3();
  private readonly faceNormals = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  private readonly pointer = new THREE.Vector2();
  private readonly target = new THREE.Vector3();
  private readonly blocked = new Map<number, number>();
  private bombTarget: number | null = null;
  private blocks: readonly GridBlock[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private readonly orbit = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI * 0.16, Math.PI * 0.22, 0, "YXZ"));
  private readonly orbitDelta = new THREE.Quaternion();
  private dimensions: Position3 = { x: 4, y: 4, z: 4 };
  private activeSize = 4;
  private zoomFactor = 1;
  private baseRadius = 7;
  private radius = 7;
  private minRadius = 4;
  private maxRadius = 14;

  constructor(private readonly canvas: HTMLCanvasElement, options: GameSceneOptions = {}) {
    this.hud = options.sceneHud ? new SceneHud() : null;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(getDevicePixelRatio());
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.createStage();
    this.resize();
  }

  setHudState(state: UiState): void { this.hudState = state; }

  loadBlocks(blocks: readonly GridBlock[], dimensions: Position3): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      const materials = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
      for (const material of new Set(materials)) {
        (material as THREE.MeshBasicMaterial).map?.dispose();
        material.dispose();
      }
      this.mesh.dispose();
    }
    this.blocked.clear();
    this.bombTarget = null;
    this.blocks = blocks;
    const count = Math.max(1, blocks.length);
    // Unit cells and half-integer centers share exact float32 edge positions.
    // Apply world scale once, after all instance transforms, to avoid cracks
    // caused by independently rounded 0.82-sized faces and translations.
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (const name of ["exposedPositive", "exposedNegative"]) {
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    }
    this.mesh = new THREE.InstancedMesh(geometry, createBlockMaterials(this.renderer.capabilities.getMaxAnisotropy()), count);
    this.mesh.scale.setScalar(BLOCK_SIZE);
    this.mesh.updateMatrixWorld(true);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.activeSize = Math.max(dimensions.x, dimensions.y, dimensions.z);
    this.dimensions = { ...dimensions };
    this.target.set(0, ((dimensions.y - 1) * BLOCK_SIZE) / 2, 0);
    this.camera.far = Math.max(100, this.activeSize * BLOCK_SIZE * 40);
    this.camera.updateProjectionMatrix();
    this.frameActiveBlocks();
    this.updateBlocks(blocks);
  }

  updateBlocks(blocks: readonly GridBlock[]): void {
    if (!this.mesh) return;
    this.blocks = blocks;
    // Internal, touching faces must never reach the depth buffer. In
    // particular a dark rear face can otherwise bleed through a shared edge
    // when viewed nearly edge-on. Moving/shaking cells expose all their faces.
    const stationary = new Set(blocks.filter(block => block.active && !block.flying && block.scale === 1
      && !this.blocked.has(block.instanceId)).map(block => cellKey(block.grid.x, block.grid.y, block.grid.z)));
    const positive = this.mesh.geometry.getAttribute("exposedPositive") as THREE.InstancedBufferAttribute;
    const negative = this.mesh.geometry.getAttribute("exposedNegative") as THREE.InstancedBufferAttribute;
    for (const block of blocks) {
      const direction = block.faceArrows[0]!.direction;
      this.direction.set(direction.x, direction.y, direction.z).normalize();
      this.rotation.setFromUnitVectors(this.localForward, this.direction);
      this.scale.setScalar(block.active ? block.scale : 0);
      this.position.copy(block.current);
      this.color.set(block.color);
      if (block.instanceId === this.bombTarget) this.color.copy(this.warningColor);
      const remaining = this.blocked.get(block.instanceId) ?? 0;
      if (remaining > 0) {
        const elapsed = 0.42 - remaining, envelope = remaining / 0.42;
        this.position.addScaledVector(this.direction, Math.sin(elapsed * 65) * 0.035 * envelope);
        this.color.lerp(this.warningColor, (0.65 + 0.35 * Math.cos(elapsed * 50)) * envelope);
      }
      for (let axis = 0; axis < 3; axis++) {
        this.faceDirection.copy(this.faceNormals[axis]!).applyQuaternion(this.rotation).round();
        for (const sign of [1, -1]) {
          const hidden = !block.flying && block.scale === 1 && !this.blocked.has(block.instanceId)
            && stationary.has(cellKey(block.grid.x + sign * this.faceDirection.x,
              block.grid.y + sign * this.faceDirection.y, block.grid.z + sign * this.faceDirection.z));
          (sign === 1 ? positive : negative).setComponent(block.instanceId, axis, block.active && !hidden ? 1 : 0);
        }
      }
      this.position.divideScalar(BLOCK_SIZE);
      this.matrix.compose(this.position, this.rotation, this.scale);
      for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
        if (Math.abs(this.matrix.elements[index]!) < 1e-12) this.matrix.elements[index] = 0;
      }
      this.mesh.setMatrixAt(block.instanceId, this.matrix);
      this.mesh.setColorAt(block.instanceId, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    positive.needsUpdate = true;
    negative.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  showBlocked(block: GridBlock): void {
    this.blocked.set(block.instanceId, 0.42);
    this.updateBlocks(this.blocks);
  }

  setBombTarget(instanceId: number | null): void {
    this.bombTarget = instanceId;
    this.updateBlocks(this.blocks);
  }

  pickBlock(clientX: number, clientY: number): PickResult | null {
    if (!this.mesh) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.pointer.y = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false).find((item) => {
      const block = item.instanceId === undefined ? undefined : this.blocks[item.instanceId];
      return block?.active && !block.flying;
    });
    if (!hit || hit.instanceId === undefined || !hit.face) return null;
    this.mesh.getMatrixAt(hit.instanceId, this.matrix);
    return { instanceId: hit.instanceId, faceNormal: dominantAxis(hit.face.normal.clone().transformDirection(this.matrix)) };
  }

  pickHudAction(clientX: number, clientY: number): SceneHudAction | null {
    if (!this.hud || !this.hudState) return null;
    this.hud.update(this.width, this.height, this.hudState);
    const rect = this.canvas.getBoundingClientRect();
    return this.hud.pick(clientX - rect.left, clientY - rect.top);
  }

  rotate(deltaX: number, deltaY: number): void {
    // Orbit around screen up/right, even upside down or directly over a pole.
    this.orbit.multiply(this.orbitDelta.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -deltaX * 0.006));
    this.orbit.multiply(this.orbitDelta.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -deltaY * 0.005)).normalize();
    this.updateCamera();
  }

  zoom(delta: number): void {
    this.zoomFactor = THREE.MathUtils.clamp(this.zoomFactor * delta, 0.55, 1.85);
    this.radius = THREE.MathUtils.clamp(this.baseRadius * this.zoomFactor, this.minRadius, this.maxRadius);
    this.updateCamera();
  }

  resize(): void {
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.frameActiveBlocks(false);
  }

  render(dt = 0): void {
    if (this.blocked.size) {
      for (const [id, remaining] of this.blocked) {
        if (remaining <= dt) this.blocked.delete(id);
        else this.blocked.set(id, remaining - dt);
      }
      this.updateBlocks(this.blocks);
    }
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.hud && this.hudState) {
      this.hud.update(this.width, this.height, this.hudState);
      this.renderer.clearDepth();
      this.renderer.render(this.hud.scene, this.hud.camera);
    }
  }

  samplePixels(): { height: number; nonBackground: number; uniqueColors: number; width: number } {
    const gl = this.renderer.getContext();
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    const pixel = new Uint8Array(4), colors = new Set<string>();
    let nonBackground = 0;
    for (let ix = 0; ix < 7; ix++) {
      for (let iy = 0; iy < 7; iy++) {
        const x = Math.min(width - 1, Math.round(((ix + 0.5) * width) / 7));
        const y = Math.min(height - 1, Math.round(((iy + 0.5) * height) / 7));
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        colors.add(Array.from(pixel).join(","));
        if (Math.abs(pixel[0]! - 40) + Math.abs(pixel[1]! - 45) + Math.abs(pixel[2]! - 88) > 24) nonBackground++;
      }
    }
    return { height, nonBackground, uniqueColors: colors.size, width };
  }

  private get width(): number { return this.canvas.clientWidth || globalThis.innerWidth || 1; }
  private get height(): number { return this.canvas.clientHeight || globalThis.innerHeight || 1; }

  private updateCamera(): void {
    this.camera.position.set(0, 0, this.radius).applyQuaternion(this.orbit).add(this.target);
    this.camera.up.set(0, 1, 0).applyQuaternion(this.orbit);
    this.camera.quaternion.copy(this.orbit);
    this.camera.updateMatrixWorld();
    this.stage.visible = this.camera.position.y >= this.target.y;
  }

  private frameActiveBlocks(resetZoom = true): void {
    const insets = getHudInsets();
    const playTop = insets.top + 148, playBottom = this.height - insets.bottom - 108;
    const playHeight = Math.max(80, playBottom - playTop);
    const centerY = (playTop + playBottom) / 2;
    this.camera.setViewOffset(this.width, this.height, 0, this.height / 2 - centerY, this.width, this.height);
    const inverse = this.orbit.clone().invert();
    const tanY = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanX = tanY * this.camera.aspect;
    let radius = 0;
    // Fit all eight perspective-projected corners to 90% width, also keeping
    // short/landscape displays clear of the header and footer.
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const corner = new THREE.Vector3(x * this.dimensions.x, y * this.dimensions.y, z * this.dimensions.z)
        .multiplyScalar(BLOCK_SIZE / 2).applyQuaternion(inverse);
      radius = Math.max(radius, corner.z + Math.abs(corner.x) / (tanX * 0.9),
        corner.z + Math.abs(corner.y) / (tanY * playHeight / this.height));
    }
    this.baseRadius = radius;
    this.minRadius = Math.max(this.activeSize * BLOCK_SIZE * 0.9, this.baseRadius * 0.55);
    this.maxRadius = Math.max(this.baseRadius * 2.2, this.minRadius + 1);
    if (resetZoom) this.zoomFactor = 1;
    this.radius = THREE.MathUtils.clamp(this.baseRadius * this.zoomFactor, this.minRadius, this.maxRadius);
    this.updateCamera();
  }

  private createStage(): void {
    this.scene.background = new THREE.Color(0x282d58);
    this.renderer.setClearColor(0x282d58, 1);
    const grid = new THREE.GridHelper(10, 12, 0x54609a, 0x39406d);
    grid.position.y = -0.56;
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
      material.transparent = true; material.opacity = 0.22;
    }
    this.stage.add(grid);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5.4, 48), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide
    }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.58;
    this.stage.add(floor);
    this.scene.add(this.stage);
  }
}

function dominantAxis(vector: THREE.Vector3): Position3 {
  const x = Math.abs(vector.x), y = Math.abs(vector.y), z = Math.abs(vector.z);
  if (x >= y && x >= z) return { x: Math.sign(vector.x) || 1, y: 0, z: 0 };
  if (y >= x && y >= z) return { x: 0, y: Math.sign(vector.y) || 1, z: 0 };
  return { x: 0, y: 0, z: Math.sign(vector.z) || 1 };
}

function cellKey(x: number, y: number, z: number): string { return `${x}:${y}:${z}`; }
