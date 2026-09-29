import * as THREE from "three";
import type { Position3 } from "./types";
import { getDevicePixelRatio } from "../platform/display";
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
  private readonly pointer = new THREE.Vector2();
  private readonly target = new THREE.Vector3();
  private readonly blocked = new Map<number, number>();
  private blocks: readonly GridBlock[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private theta = Math.PI * 0.22;
  private phi = Math.PI * 0.34;
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

  loadBlocks(blocks: readonly GridBlock[], size: number): void {
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
    this.blocks = blocks;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE),
      createBlockMaterials(this.renderer.capabilities.getMaxAnisotropy()), Math.max(1, blocks.length));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.activeSize = size;
    this.target.set(0, ((size - 1) * BLOCK_SIZE) / 2, 0);
    this.frameActiveBlocks();
    this.updateBlocks(blocks);
  }

  updateBlocks(blocks: readonly GridBlock[]): void {
    if (!this.mesh) return;
    this.blocks = blocks;
    for (const block of blocks) {
      const direction = block.faceArrows[0]!.direction;
      this.direction.set(direction.x, direction.y, direction.z).normalize();
      this.rotation.setFromUnitVectors(this.localForward, this.direction);
      this.scale.setScalar(block.active ? block.scale : 0);
      this.position.copy(block.current);
      this.color.set(block.color);
      const remaining = this.blocked.get(block.instanceId) ?? 0;
      if (remaining > 0) {
        const elapsed = 0.42 - remaining, envelope = remaining / 0.42;
        this.position.addScaledVector(this.direction, Math.sin(elapsed * 65) * 0.035 * envelope);
        this.color.lerp(this.warningColor, (0.65 + 0.35 * Math.cos(elapsed * 50)) * envelope);
      }
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.mesh.setMatrixAt(block.instanceId, this.matrix);
      this.mesh.setColorAt(block.instanceId, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  showBlocked(block: GridBlock): void {
    this.blocked.set(block.instanceId, 0.42);
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
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(this.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi), this.target.z + this.radius * sinPhi * Math.cos(this.theta));
    this.camera.lookAt(this.target);
  }

  private frameActiveBlocks(resetZoom = true): void {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(0.55, this.camera.aspect || 1);
    const desiredWidthFill = 0.35;
    const diagonalWidth = this.activeSize * BLOCK_SIZE * 1.38;
    this.baseRadius = diagonalWidth / (2 * Math.tan(fov / 2) * aspect * desiredWidthFill);
    this.minRadius = Math.max(2.2, this.baseRadius * 0.55);
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
    this.scene.add(grid);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5.4, 48), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide
    }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.58;
    this.scene.add(floor);
  }
}

function dominantAxis(vector: THREE.Vector3): Position3 {
  const x = Math.abs(vector.x), y = Math.abs(vector.y), z = Math.abs(vector.z);
  if (x >= y && x >= z) return { x: Math.sign(vector.x) || 1, y: 0, z: 0 };
  if (y >= x && y >= z) return { x: 0, y: Math.sign(vector.y) || 1, z: 0 };
  return { x: 0, y: 0, z: Math.sign(vector.z) || 1 };
}
