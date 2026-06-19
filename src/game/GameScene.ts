import * as THREE from "three";
import type { Position3 } from "./types";
import { getDevicePixelRatio, getHudInsets } from "../platform/display";
import type { UiState } from "../ui/GameUi";
import { BLOCK_COLOR, BLOCK_SIZE, type GridBlock } from "../world/CubeGrid";

export interface PickResult {
  instanceId: number;
  faceNormal: Position3;
}

export interface GameSceneOptions {
  sceneHud?: boolean;
}

type SceneHudAction = "auto" | "bomb" | "levelNext" | "levelPrev" | "reset" | "undo";

interface HudButton {
  action?: SceneHudAction;
  disabled?: boolean;
  emphasis?: boolean;
  height: number;
  label: string;
  secondary?: string;
  width: number;
  x: number;
  y: number;
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
  private readonly hudScene = new THREE.Scene();
  private readonly hudCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
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
  private readonly sceneHud: boolean;
  private arrowOverlays: Array<{
    block: GridBlock;
    direction: THREE.Vector3;
    index: number;
    normal: THREE.Vector3;
  }> = [];
  private faceBorderOverlays: Array<{ block: GridBlock; index: number; normal: Position3 }> = [];
  private hudButtons: HudButton[] = [];
  private hudKey = "";
  private hudMeshes: THREE.Mesh[] = [];
  private hudState: UiState | null = null;
  private arrowMesh: THREE.InstancedMesh | null = null;
  private faceBorderMesh: THREE.InstancedMesh | null = null;
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
    this.sceneHud = options.sceneHud ?? false;
    this.hudCamera.position.z = 10;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(getDevicePixelRatio());
    this.renderer.setClearColor(0xeef4ef, 1);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.scene.background = new THREE.Color(0xeef4ef);

    this.createLighting();
    this.createStage();
    this.resize();
  }

  setHudState(state: UiState): void {
    if (!this.sceneHud) {
      return;
    }

    this.hudState = state;
    this.hudKey = "";
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

  pickHudAction(clientX: number, clientY: number): SceneHudAction | null {
    if (!this.sceneHud) {
      return null;
    }

    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const button = this.hudButtons.find(
      (item) =>
        item.action &&
        !item.disabled &&
        x >= item.x &&
        x <= item.x + item.width &&
        y >= item.y &&
        y <= item.y + item.height
    );

    return button?.action ?? null;
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
    this.updateHudCamera(width, height);
    this.hudKey = "";
    this.frameActiveBlocks(false);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    if (this.sceneHud && this.hudState) {
      this.updateHud();
      this.renderer.clearDepth();
      this.renderer.render(this.hudScene, this.hudCamera);
    }
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

  private updateHud(): void {
    if (!this.hudState) {
      return;
    }

    const width = this.canvas.clientWidth || globalThis.innerWidth || 1;
    const height = this.canvas.clientHeight || globalThis.innerHeight || 1;
    const state = this.hudState;
    const key = [
      width,
      height,
      state.autoRunning,
      state.canUndo,
      state.level,
      state.levelCount,
      state.phase,
      state.powerups.bomb,
      state.powerups.undo,
      state.remaining,
      state.stars
    ].join(":");

    if (key === this.hudKey) {
      return;
    }

    this.hudKey = key;
    this.hudButtons = createHudButtons(width, height, state);
    this.rebuildHudMeshes();
  }

  private updateHudCamera(width: number, height: number): void {
    this.hudCamera.left = 0;
    this.hudCamera.right = width;
    this.hudCamera.top = 0;
    this.hudCamera.bottom = height;
    this.hudCamera.updateProjectionMatrix();
  }

  private rebuildHudMeshes(): void {
    for (const mesh of this.hudMeshes) {
      this.hudScene.remove(mesh);
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const item of material) {
          item.dispose();
        }
      } else {
        if ("map" in material && material.map instanceof THREE.Texture) {
          material.map.dispose();
        }
        material.dispose();
      }
    }

    this.hudMeshes = [];

    for (const button of this.hudButtons) {
      const texture = createHudTexture(button);
      const geometry = new THREE.PlaneGeometry(button.width, button.height);
      const material = new THREE.MeshBasicMaterial({
        depthTest: false,
        depthWrite: false,
        map: texture,
        transparent: true
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(button.x + button.width / 2, button.y + button.height / 2, 0);
      mesh.renderOrder = 10;
      this.hudScene.add(mesh);
      this.hudMeshes.push(mesh);
    }
  }

  private frameActiveBlocks(resetZoom = true): void {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(0.55, this.camera.aspect || 1);
    const desiredWidthFill = 0.35;
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

    for (const block of blocks) {
      for (const normal of FACE_NORMALS) {
        this.faceBorderOverlays.push({
          block,
          index: this.faceBorderOverlays.length,
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

    if (this.arrowMesh) {
      this.scene.remove(this.arrowMesh);
      this.arrowMesh.dispose();
      this.arrowMesh = null;
    }

    this.faceBorderOverlays = [];
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

function createHudButtons(width: number, height: number, state: UiState): HudButton[] {
  const gap = 8;
  const margin = 14;
  const insets = getHudInsets();
  const topY = Math.min(Math.max(insets.top, 14), Math.max(14, height - 130));
  const topHeight = 36;
  const topButtons: HudButton[] = [
    {
      action: "levelPrev",
      disabled: state.level <= 1,
      height: topHeight,
      label: "<",
      width: 34,
      x: margin,
      y: topY
    },
    {
      emphasis: true,
      height: topHeight,
      label: `难度 ${state.level}`,
      width: 78,
      x: margin + 34 + gap,
      y: topY
    },
    {
      action: "levelNext",
      disabled: state.level >= state.levelCount,
      height: topHeight,
      label: ">",
      width: 34,
      x: margin + 34 + gap + 78 + gap,
      y: topY
    },
    {
      height: topHeight,
      label: `剩余 ${state.remaining}`,
      width: 74,
      x: margin + 34 + gap + 78 + gap + 34 + gap,
      y: topY
    },
    {
      height: topHeight,
      label: renderHudStars(state.stars),
      width: 56,
      x: margin + 34 + gap + 78 + gap + 34 + gap + 74 + gap,
      y: topY
    }
  ];

  const bottomHeight = 46;
  const toolbarWidth = Math.min(width - margin * 2, 440);
  const buttonWidth = Math.floor((toolbarWidth - gap * 3) / 4);
  const bottomY = Math.max(topY + topHeight + 14, height - insets.bottom - bottomHeight);
  const startX = Math.max(margin, (width - toolbarWidth) / 2);
  const bottomButtons: HudButton[] = [
    {
      action: "reset",
      height: bottomHeight,
      label: "重置",
      secondary: "不限",
      width: buttonWidth,
      x: startX,
      y: bottomY
    },
    {
      action: "undo",
      disabled: !state.canUndo || state.phase !== "playing",
      height: bottomHeight,
      label: "撤销",
      secondary: String(state.powerups.undo),
      width: buttonWidth,
      x: startX + (buttonWidth + gap),
      y: bottomY
    },
    {
      action: "bomb",
      disabled: state.powerups.bomb <= 0 || state.remaining <= 0 || state.phase !== "playing",
      height: bottomHeight,
      label: "炸弹",
      secondary: String(state.powerups.bomb),
      width: buttonWidth,
      x: startX + (buttonWidth + gap) * 2,
      y: bottomY
    },
    {
      action: "auto",
      disabled: state.remaining <= 0 || state.phase !== "playing",
      height: bottomHeight,
      label: "自动",
      secondary: state.autoRunning ? "开" : "关",
      width: buttonWidth,
      x: startX + (buttonWidth + gap) * 3,
      y: bottomY
    }
  ];

  const lastTopButton = topButtons[topButtons.length - 1]!;
  const topFits = lastTopButton.x + lastTopButton.width <= width - margin;
  return topFits ? [...topButtons, ...bottomButtons] : [topButtons[0]!, topButtons[1]!, topButtons[2]!, ...bottomButtons];
}

function createHudTexture(button: HudButton): THREE.CanvasTexture {
  const ratio = getDevicePixelRatio();
  const canvas = createHudCanvas();
  canvas.width = Math.max(1, Math.round(button.width * ratio));
  canvas.height = Math.max(1, Math.round(button.height * ratio));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create HUD texture context.");
  }

  context.scale(ratio, ratio);
  context.clearRect(0, 0, button.width, button.height);
  drawRoundedRect(context, 0, 0, button.width, button.height, 9);
  context.fillStyle = button.disabled
    ? "rgba(225, 228, 238, 0.54)"
    : button.emphasis
      ? "rgba(246, 247, 252, 0.96)"
      : "rgba(241, 243, 248, 0.9)";
  context.fill();
  context.strokeStyle = button.emphasis ? "rgba(25, 31, 38, 0.18)" : "rgba(25, 31, 38, 0.1)";
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = button.disabled ? "rgba(22, 29, 36, 0.42)" : "#101820";
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (button.secondary) {
    context.font = "700 14px sans-serif";
    context.fillText(button.label, button.width / 2, button.height * 0.38);
    context.font = "600 10px sans-serif";
    context.fillText(button.secondary, button.width / 2, button.height * 0.72);
  } else {
    context.font = button.label.length <= 1 ? "800 20px sans-serif" : "800 13px sans-serif";
    context.fillText(button.label, button.width / 2, button.height / 2 + 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createHudCanvas(): HTMLCanvasElement {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    return document.createElement("canvas");
  }

  const canvas = typeof wx !== "undefined" ? wx?.createCanvas?.() : undefined;
  if (!canvas) {
    throw new Error("No canvas available for HUD texture.");
  }

  return canvas;
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function renderHudStars(stars: number): string {
  return `${"★".repeat(stars)}${"☆".repeat(3 - stars)}`;
}

function createArrowStrokeGeometry(): THREE.BufferGeometry {
  const tailY = -BLOCK_SIZE * 0.32;
  const tipY = BLOCK_SIZE * 0.28;
  const wingX = BLOCK_SIZE * 0.2;
  const wingY = BLOCK_SIZE * 0.08;

  return createStrokeGeometry([
    [new THREE.Vector2(0, tailY), new THREE.Vector2(0, tipY)],
    [new THREE.Vector2(0, tipY), new THREE.Vector2(-wingX, wingY)],
    [new THREE.Vector2(0, tipY), new THREE.Vector2(wingX, wingY)]
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
