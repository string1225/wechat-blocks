import * as THREE from "three";
import { createTextureCanvas } from "../platform/canvas";

export function createBlockMaterials(anisotropy: number): THREE.MeshBasicMaterial[] {
  const side = faceMaterial("arrow", anisotropy);
  const front = faceMaterial("front", anisotropy);
  const rear = faceMaterial("rear", anisotropy);
  // BoxGeometry order: +X, -X, +Y, -Y, +Z, -Z. Each instance rotates
  // local +Y to its flight direction, so the rear face is always local -Y.
  return [side, side, front, rear, side, side];
}

function faceMaterial(kind: "arrow" | "front" | "rear", anisotropy: number): THREE.MeshBasicMaterial {
  const size = 256;
  const canvas = createTextureCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to draw block faces.");
  context.fillStyle = kind === "rear" ? "#e0e0e0" : "#ffffff";
  context.fillRect(0, 0, size, size);
  context.strokeStyle = "#243528";
  context.lineWidth = 2.5;
  context.strokeRect(1.25, 1.25, size - 2.5, size - 2.5);
  if (kind === "arrow") {
    context.lineWidth = 8;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(size / 2, size * 0.79);
    context.lineTo(size / 2, size * 0.23);
    context.moveTo(size * 0.32, size * 0.43);
    context.lineTo(size / 2, size * 0.23);
    context.lineTo(size * 0.68, size * 0.43);
    context.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = Math.min(anisotropy, 8);
  // The markings share the cube's actual triangles and depth. There are no
  // displaced, double-sided arrow planes that can peek around an edge.
  const material = new THREE.MeshBasicMaterial({ map, side: THREE.FrontSide, depthTest: true, depthWrite: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec3 exposedPositive;
attribute vec3 exposedNegative;
varying float vFaceExposed;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
vFaceExposed = dot(max(normal, vec3(0.0)), exposedPositive)
  + dot(max(-normal, vec3(0.0)), exposedNegative);`);
    shader.fragmentShader = `varying float vFaceExposed;\n${shader.fragmentShader}`
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
if (vFaceExposed < 0.5) discard;`);
  };
  material.customProgramCacheKey = () => "solid-block-exposed-faces-v1";
  return material;
}
