import * as THREE from "three";
import { createTextureCanvas } from "../platform/canvas";
import { getDevicePixelRatio, getHudInsets } from "../platform/display";
import { formatTime } from "./formatTime";
import type { UiState } from "./GameUi";

export type SceneHudAction = "auto" | "bomb" | "bombConfirm" | "bombCancel" | "levelNext" | "levelPrev" | "reset" | "undo" | "consume";
export interface HudElement {
  x: number; y: number; width: number; height: number;
  label: string; secondary?: string; disabled?: boolean;
  action?: SceneHudAction; role?: "card" | "primary" | "scrim" | "panel" | "brand" | "metric" | "text" | "tool";
  icon?: "reset" | "undo" | "bomb" | "play" | "pause"; active?: boolean;
}

export function layoutSceneHud(width: number, height: number, state: UiState): HudElement[] {
  const insets = getHudInsets();
  const margin = 12;
  const titleTop = Math.min(insets.top, Math.max(12, height - 260));
  const available = width - margin * 2, left = margin;
  const top = titleTop + 54;
  const stepWidth = Math.min(92, available - 174);
  const elements: HudElement[] = [
    { x: 0, y: 0, width, height: titleTop + 102, label: "", role: "panel" },
    { x: left, y: titleTop, width: available - 100, height: 44, label: "智能消方块", secondary: "3D 空间消除", role: "brand" },
    { x: left + available - 80, y: titleTop, width: 80, height: 44, label: formatTime(state.elapsedSeconds), secondary: "本局用时", role: "metric" },
    { x: left, y: top, width: 32, height: 36, label: "‹", action: "levelPrev", disabled: state.level <= 1 },
    { x: left + 36, y: top, width: stepWidth, height: 36, label: `难度 ${state.level}`, role: "text" },
    { x: left + 40 + stepWidth, y: top, width: 32, height: 36, label: "›", action: "levelNext" },
    { x: left + available - 78, y: top, width: 78, height: 36, label: `剩余 ${state.remaining}`, role: "metric" }
  ];
  const buttonWidth = width / 4, barY = height - insets.bottom - 104;
  elements.push({ x: 0, y: barY, width, height: height - barY, label: "", role: "panel" });
  elements.push({ x: 0, y: barY, width, height: 28, label: "拖动自由旋转 · 双指缩放", role: "text" });
  const tools: Array<Pick<HudElement, "label" | "secondary" | "action" | "disabled" | "role" | "icon" | "active">> = [
    { label: "重置", secondary: "重新开始", action: "reset", icon: "reset" },
    { label: "撤销", secondary: `${state.powerups.undo} 次可用`, action: "undo", icon: "undo", disabled: !state.canUndo || state.phase !== "playing" },
    { label: "炸弹", secondary: state.bombArmed ? "点选方块" : `${state.powerups.bomb} 枚可用`, action: "bomb", icon: "bomb", active: state.bombArmed,
      disabled: state.powerups.bomb <= 0 || state.remaining <= 0 || state.phase !== "playing" },
    { label: "自动", secondary: state.autoRunning ? "进行中" : "已关闭", action: "auto", icon: state.autoRunning ? "pause" : "play", active: state.autoRunning,
      disabled: state.remaining <= 0 || state.phase !== "playing" }
  ];
  // Button backgrounds and hit areas extend through the bottom safe area.
  tools.forEach((tool, index) => elements.push({ ...tool, role: "tool", x: index * buttonWidth,
    y: barY + 28, width: buttonWidth, height: 76 + insets.bottom }));
  if (state.bombArmed && state.phase === "playing") {
    elements.push({ x: left, y: titleTop + 110, width: available, height: 32,
      label: "点选要炸的格子 · 再点炸弹可取消", role: "primary" });
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
        secondary: `难度 ${state.level} · 用时 ${formatTime(state.elapsedSeconds)} · ${stars(state.stars)}`, role: "card" },
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
  private meshes = new Map<string, THREE.Mesh>();
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
    const previous = this.meshes;
    this.meshes = new Map();
    this.elements = layoutSceneHud(width, height, state);
    for (const [index, element] of this.elements.entries()) {
      // Reuse unchanged controls: the one-second timer redraws only its tile.
      const identity = JSON.stringify([element, getDevicePixelRatio()]);
      let mesh = previous.get(identity);
      if (mesh) previous.delete(identity);
      else {
        const material = new THREE.MeshBasicMaterial({ map: drawElement(element), transparent: true, depthTest: false, depthWrite: false });
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(element.width, element.height), material);
        this.scene.add(mesh);
      }
      mesh.position.set(element.x + element.width / 2, height - element.y - element.height / 2, 0);
      mesh.renderOrder = index;
      this.meshes.set(identity, mesh);
    }
    for (const mesh of previous.values()) {
      this.scene.remove(mesh); mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.map?.dispose(); material.dispose();
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
    const { width, height, role } = element;
    const plain = role === "text" || role === "brand";
    const selected = element.active || role === "primary";
    const accent = element.icon === "bomb" ? "#ffd18c" : "#95f5cd";
    if (!plain) {
      roundedRect(ctx, width, height, role === "panel" || role === "tool" ? 0 : role === "card" ? 22 : 12);
      ctx.fillStyle = selected ? accent : role === "panel" || role === "card" ? "#202744" : role === "metric" ? "#2b3455" : "#333d60";
      ctx.fill();
      ctx.strokeStyle = selected ? accent : "#465071"; ctx.lineWidth = 1; ctx.stroke();
    }
    if (role !== "panel") {
      const foreground = selected ? "#173e34" : element.disabled ? "#8490af" : "#f2f7ff";
      ctx.fillStyle = foreground;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const card = role === "card", tool = role === "tool", brand = role === "brand";
      ctx.font = `700 ${card ? 25 : brand ? 19 : role === "metric" && element.secondary ? 20 : role === "text" ? 12 : 15}px sans-serif`;
      ctx.fillText(element.label, width / 2, card ? 47 : tool ? 43 : element.secondary ? height * 0.35 : height / 2, width - 8);
      if (element.icon) drawIcon(ctx, element.icon, width / 2, 18, foreground);
      if (element.secondary) {
        ctx.fillStyle = selected ? "#32604e" : element.disabled ? "#75809e" : "#aab8d3";
        ctx.font = `${brand ? "500" : "400"} ${card ? 12 : 10}px sans-serif`;
        ctx.fillText(element.secondary, width / 2, card ? 89 : tool ? 62 : height * 0.77, width - 6);
      }
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

function drawIcon(ctx: CanvasRenderingContext2D, icon: NonNullable<HudElement["icon"]>, x: number, y: number, color: string): void {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 1.8; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
  if (icon === "play") { ctx.moveTo(-4, -7); ctx.lineTo(7, 0); ctx.lineTo(-4, 7); ctx.closePath(); }
  else if (icon === "pause") { ctx.moveTo(-4, -6); ctx.lineTo(-4, 6); ctx.moveTo(4, -6); ctx.lineTo(4, 6); }
  else if (icon === "bomb") {
    ctx.arc(-1, 2, 6, 0, Math.PI * 2); ctx.moveTo(3, -3); ctx.lineTo(5, -6); ctx.lineTo(8, -6);
    ctx.moveTo(8, -9); ctx.lineTo(8, -8); ctx.moveTo(11, -6); ctx.lineTo(10, -6);
  } else if (icon === "reset") {
    ctx.arc(0, 0, 7, -Math.PI * 0.8, Math.PI * 0.8); ctx.moveTo(-6, -7); ctx.lineTo(-6, -2); ctx.lineTo(-1, -2);
  } else { ctx.moveTo(-7, -3); ctx.lineTo(0, -3); ctx.quadraticCurveTo(8, -3, 7, 5); ctx.moveTo(-3, -7); ctx.lineTo(-7, -3); ctx.lineTo(-3, 1); }
  ctx.stroke(); ctx.restore();
}
