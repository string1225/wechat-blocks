export function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
