import * as THREE from "three";
import type { Position3 } from "./types";
import { BLOCK_COLOR, BLOCK_SIZE, type GridBlock } from "../world/CubeGrid";

export interface PickResult {
  instanceId: number;
  faceNormal: Position3;
}

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
  private readonly arrowGeometry = createArrowLineGeometry();
  private readonly arrowMaterial = new THREE.LineBasicMaterial({
    color: 0x17341f,
    transparent: true,
    opacity: 0.92,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  private readonly edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE));
  private readonly edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x17341f,
    transparent: true,
    opacity: 0.88
  });
  private readonly arrowMatrix = new THREE.Matrix4();
  private readonly arrowXAxis = new THREE.Vector3();
  private readonly arrowYAxis = new THREE.Vector3();
  private readonly arrowZAxis = new THREE.Vector3();
  private arrowMeshes: Array<{
    block: GridBlock;
    direction: THREE.Vector3;
    line: THREE.LineSegments;
    normal: THREE.Vector3;
  }> = [];
  private edgeLines: Array<{ block: GridBlock; line: THREE.LineSegments }> = [];
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

    this.updateBlockOverlays();
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
    for (const block of blocks) {
      const line = new THREE.LineSegments(this.edgeGeometry, this.edgeMaterial);
      line.renderOrder = 2;
      this.edgeLines.push({ block, line });
      this.scene.add(line);

      for (const arrow of block.faceArrows) {
        const line = new THREE.LineSegments(this.arrowGeometry, this.arrowMaterial);
        line.renderOrder = 3;
        this.arrowMeshes.push({
          block,
          direction: positionToVector(arrow.direction),
          line,
          normal: positionToVector(arrow.normal)
        });
        this.scene.add(line);
      }
    }
  }

  private clearBlockOverlays(): void {
    for (const item of this.edgeLines) {
      this.scene.remove(item.line);
    }
    this.edgeLines = [];

    for (const item of this.arrowMeshes) {
      this.scene.remove(item.line);
    }
    this.arrowMeshes = [];
  }

  private updateBlockOverlays(): void {
    for (const item of this.edgeLines) {
      item.line.visible = item.block.active;
      item.line.position.copy(item.block.current);
      item.line.scale.setScalar(item.block.active ? item.block.scale : 0.001);
    }

    for (const item of this.arrowMeshes) {
      item.line.visible = item.block.active;
      item.line.position.copy(item.block.current).addScaledVector(item.normal, (BLOCK_SIZE / 2) * item.block.scale + 0.012);
      this.arrowYAxis.copy(item.direction).normalize();
      this.arrowZAxis.copy(item.normal).normalize();
      this.arrowXAxis.crossVectors(this.arrowYAxis, this.arrowZAxis).normalize();
      this.arrowMatrix.makeBasis(this.arrowXAxis, this.arrowYAxis, this.arrowZAxis);
      item.line.quaternion.setFromRotationMatrix(this.arrowMatrix);
      item.line.scale.setScalar(item.block.active ? item.block.scale : 0.001);
    }
  }
}

function createArrowLineGeometry(): THREE.BufferGeometry {
  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -0.28, 0),
    new THREE.Vector3(0, 0.22, 0),
    new THREE.Vector3(0, 0.22, 0),
    new THREE.Vector3(-0.14, 0.06, 0),
    new THREE.Vector3(0, 0.22, 0),
    new THREE.Vector3(0.14, 0.06, 0)
  ]);
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
