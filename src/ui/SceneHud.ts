import * as THREE from "three";
import { createTextureCanvas } from "../platform/canvas";
import { getDevicePixelRatio, getHudInsets } from "../platform/display";
import type { UiState } from "./GameUi";

export type SceneHudAction = "auto" | "bomb" | "bombConfirm" | "bombCancel" | "levelNext" | "levelPrev" | "reset" | "undo" | "consume";
export interface HudElement {
  x: number; y: number; width: number; height: number;
  label: string; secondary?: string; disabled?: boolean;
  action?: SceneHudAction; role?: "card" | "primary" | "scrim";
}

export function layoutSceneHud(width: number, height: number, state: UiState): HudElement[] {
  const insets = getHudInsets();
  const margin = 12, gap = 8;
  const top = Math.min(insets.top, Math.max(12, height - 180));
  const available = width - margin * 2;
  const stepWidth = Math.min(80, available - 84);
  const elements: HudElement[] = [
    { x: margin, y: top, width: 34, height: 38, label: "‹", action: "levelPrev", disabled: state.level <= 1 },
    { x: margin + 42, y: top, width: stepWidth, height: 38, label: `难度 ${state.level}` },
    { x: margin + 50 + stepWidth, y: top, width: 34, height: 38, label: "›", action: "levelNext" }
  ];
  const statsWidth = 128;
  const statsInline = available >= stepWidth + 92 + statsWidth;
  elements.push({ x: statsInline ? width - margin - statsWidth : margin, y: statsInline ? top : top + 44,
    width: statsWidth, height: 38, label: `剩余 ${state.remaining}`, secondary: stars(state.stars) });
  const barWidth = Math.min(available, 440);
  const buttonWidth = (barWidth - gap * 3) / 4;
  const barX = (width - barWidth) / 2;
  const barY = Math.max(top + 92, height - insets.bottom - 54);
  const tools: Array<Pick<HudElement, "label" | "secondary" | "action" | "disabled" | "role">> = [
    { label: "重置", secondary: "不限", action: "reset" },
    { label: "撤销", secondary: String(state.powerups.undo), action: "undo", disabled: !state.canUndo || state.phase !== "playing" },
    { label: "炸弹", secondary: state.bombArmed ? "已选中" : String(state.powerups.bomb), action: "bomb", role: state.bombArmed ? "primary" : undefined,
      disabled: state.powerups.bomb <= 0 || state.remaining <= 0 || state.phase !== "playing" },
    { label: "自动", secondary: state.autoRunning ? "开启" : "关闭", action: "auto", disabled: state.remaining <= 0 || state.phase !== "playing" }
  ];
  tools.forEach((tool, index) => elements.push({ ...tool, x: barX + index * (buttonWidth + gap), y: barY, width: buttonWidth, height: 54 }));
  if (state.bombArmed && state.phase === "playing") {
    elements.push({ x: margin, y: top + (statsInline ? 46 : 90), width: available, height: 36,
      label: "点选要炸的格子 · 再点炸弹可取消" });
  }
  if (state.bombTarget && state.phase === "playing") {
    const cardWidth = Math.min(310, available), x = (width - cardWidth) / 2;
    const y = Math.max(top + 45, barY - 216);
    elements.push(
      { x: 0, y: 0, width, height, label: "", role: "scrim" },
      { x, y, width: cardWidth, height: 204, label: "炸掉这个格子？", secondary: "消耗 1 枚炸弹，只移除高亮的格子", role: "card" },
      { x: x + 18, y: y + 134, width: (cardWidth - 44) / 2, height: 48, label: "取消", action: "bombCancel" },
      { x: x + cardWidth / 2 + 4, y: y + 134, width: (cardWidth - 44) / 2, height: 48, label: "确认炸掉", action: "bombConfirm", role: "primary" }
    );
  }
  if (state.phase !== "playing") {
    const won = state.phase === "won";
    const cardWidth = Math.min(310, available), cardHeight = 204;
    const x = (width - cardWidth) / 2, y = Math.max(top + 45, (height - cardHeight) / 2);
    elements.push(
      { x: 0, y: 0, width, height, label: "", role: "scrim" },
      { x, y, width: cardWidth, height: cardHeight, label: won ? "过关了！" : "再试一次",
        secondary: `难度 ${state.level} · ${state.moves} 步 · ${stars(state.stars)}`, role: "card" },
      { x: x + 18, y: y + 134, width: (cardWidth - 44) / 2, height: 48, label: "重新挑战", action: "reset" },
      { x: x + cardWidth / 2 + 4, y: y + 134, width: (cardWidth - 44) / 2, height: 48,
        label: won ? "下一关" : "继续挑战", action: won ? "levelNext" : "reset", role: "primary" }
    );
  }
  return elements;
}

export class SceneHud {
  readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 100);
  readonly scene = new THREE.Scene();
  private elements: HudElement[] = [];
  private meshes: THREE.Mesh[] = [];
  private key = "";

  constructor() { this.camera.position.z = 10; }

  update(width: number, height: number, state: UiState): void {
    const key = JSON.stringify([width, height, getDevicePixelRatio(), getHudInsets(), state]);
    if (key === this.key) return;
    this.key = key;
    // Positive Y points up in 3D. Convert UI coordinates at placement time;
    // reversing camera top/bottom flips triangle winding and culls the HUD.
    this.camera.left = 0; this.camera.right = width;
    this.camera.top = height; this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
    this.clear();
    this.elements = layoutSceneHud(width, height, state);
    for (const [index, element] of this.elements.entries()) {
      const texture = drawElement(element);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(element.width, element.height), material);
      mesh.position.set(element.x + element.width / 2, height - element.y - element.height / 2, 0);
      mesh.renderOrder = index;
      this.scene.add(mesh); this.meshes.push(mesh);
    }
  }

  pick(x: number, y: number): SceneHudAction | null {
    // Reverse paint order keeps the result dialog modal and consumes disabled controls.
    for (const element of [...this.elements].reverse()) {
      if (x >= element.x && x <= element.x + element.width && y >= element.y && y <= element.y + element.height) {
        return !element.disabled && element.action ? element.action : "consume";
      }
    }
    return null;
  }

  private clear(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh); mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.map?.dispose(); material.dispose();
    }
    this.meshes = [];
  }
}

function drawElement(element: HudElement): THREE.CanvasTexture {
  const ratio = getDevicePixelRatio();
  // A solid scrim needs only one texel, even on high-DPR phones.
  const canvas = createTextureCanvas(element.role === "scrim" ? 1 : Math.ceil(element.width * ratio),
    element.role === "scrim" ? 1 : Math.ceil(element.height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to draw game controls.");
  if (element.role === "scrim") {
    ctx.fillStyle = "rgba(12,18,40,0.65)"; ctx.fillRect(0, 0, 1, 1);
  } else {
    ctx.scale(ratio, ratio);
    roundedRect(ctx, element.width, element.height, element.role === "card" ? 18 : 10);
    ctx.fillStyle = element.role === "primary" ? "#287b57" : element.disabled ? "#989bae" : "#f1f3f8";
    ctx.fill();
    ctx.fillStyle = element.role === "primary" ? "#ffffff" : element.disabled ? "#4b5062" : "#17202b";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const card = element.role === "card";
    ctx.font = `700 ${card ? 27 : 15}px sans-serif`;
    ctx.fillText(element.label, element.width / 2, card ? 47 : element.secondary ? element.height * 0.37 : element.height / 2);
    if (element.secondary) {
      ctx.font = `${card ? 14 : 11}px sans-serif`;
      ctx.fillText(element.secondary, element.width / 2, card ? 89 : element.height * 0.75);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundedRect(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number): void {
  ctx.beginPath(); ctx.moveTo(radius, 0); ctx.lineTo(width - radius, 0);
  ctx.quadraticCurveTo(width, 0, width, radius); ctx.lineTo(width, height - radius);
  ctx.quadraticCurveTo(width, height, width - radius, height); ctx.lineTo(radius, height);
  ctx.quadraticCurveTo(0, height, 0, height - radius); ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0); ctx.closePath();
}
function stars(count: number): string { return "★".repeat(count) + "☆".repeat(Math.max(0, 3 - count)); }
