import * as THREE from "three";
import type { GridBlock } from "../world/CubeGrid";

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
  private mesh: THREE.InstancedMesh | null = null;
  private theta = Math.PI * 0.22;
  private phi = Math.PI * 0.34;
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

    const geometry = new THREE.BoxGeometry(0.92, 0.92, 0.92);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.04
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, blocks.length));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scene.add(this.mesh);

    this.target.set(0, ((size - 1) * 1.08) / 2, 0);
    this.radius = THREE.MathUtils.clamp(size * 2.25 + 2.2, this.minRadius, this.maxRadius);
    this.minRadius = Math.max(3.4, size * 1.55);
    this.maxRadius = Math.max(8, size * 4.2);
    this.updateCamera();
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
      this.mesh.setColorAt(block.instanceId, new THREE.Color(block.color));
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  pickInstance(clientX: number, clientY: number): number | null {
    if (!this.mesh) {
      return null;
    }

    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.pointer.y = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObject(this.mesh, false);
    const hit = hits.find((item) => item.instanceId !== undefined);
    return hit?.instanceId ?? null;
  }

  rotate(deltaX: number, deltaY: number): void {
    this.theta -= deltaX * 0.006;
    this.phi = THREE.MathUtils.clamp(this.phi - deltaY * 0.005, 0.22, Math.PI * 0.48);
    this.updateCamera();
  }

  zoom(delta: number): void {
    this.radius = THREE.MathUtils.clamp(this.radius * delta, this.minRadius, this.maxRadius);
    this.updateCamera();
  }

  resize(): void {
    const width = this.canvas.clientWidth || globalThis.innerWidth || 1;
    const height = this.canvas.clientHeight || globalThis.innerHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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

  private createLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x9fb2a6, 2.25);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(4, 7, 5);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8cc7ff, 0.86);
    fill.position.set(-5, 4, -4);
    this.scene.add(fill);
  }

  private createStage(): void {
    const grid = new THREE.GridHelper(10, 12, 0x8aa59a, 0xc6d5ca);
    grid.position.y = -0.56;
    const material = grid.material;
    if (Array.isArray(material)) {
      for (const item of material) {
        item.transparent = true;
        item.opacity = 0.36;
      }
    } else {
      material.transparent = true;
      material.opacity = 0.36;
    }
    this.scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(5.4, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.58;
    this.scene.add(floor);
  }
}
