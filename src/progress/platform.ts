export const PROGRESS_API = "https://www.sunny-string.cn/wechat/game/api";
export const STORAGE_KEY = "wechat-blocks.progress.v1";

export interface ProgressPlatform {
  read(): string | null;
  write(value: string): void;
  backup(value: string): void;
  request(path: string, method: "GET" | "POST" | "PUT", token?: string, data?: unknown): Promise<ApiResponse>;
  login?: () => Promise<string>;
  onResume(callback: () => void): void;
  onHide(callback: () => void): void;
}
export interface ApiResponse { status: number; data: any }

export function createProgressPlatform(): ProgressPlatform {
  const runtime = typeof wx !== "undefined" ? wx : undefined;
  const write = (key: string, value: string): void => {
    try {
      if (runtime?.setStorageSync) runtime.setStorageSync(key, value);
      else if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    } catch { /* A full or unavailable local cache must not interrupt play. */ }
  };
  return {
    read() {
      try {
        const value = runtime?.getStorageSync ? runtime.getStorageSync(STORAGE_KEY)
          : typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        return typeof value === "string" ? value : null;
      } catch { return null; }
    },
    write: (value) => write(STORAGE_KEY, value),
    backup: (value) => write(`${STORAGE_KEY}.conflict`, value),
    request(path, method, token, data) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (runtime?.request) {
        return new Promise((resolve, reject) => runtime.request!({
          url: `${PROGRESS_API}${path}`, method, header: headers, data, timeout: 5000,
          success: (result) => resolve({ status: result.statusCode, data: result.data }), fail: reject
        }));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const body = data === undefined ? undefined : JSON.stringify(data);
      return fetch(`${PROGRESS_API}${path}`, {
        method, headers, body,
        signal: controller.signal, keepalive: method === "PUT" && (body?.length ?? 0) < 60000, credentials: "omit"
      }).then(async (response) => ({ status: response.status, data: await response.json() }))
        .finally(() => clearTimeout(timer));
    },
    login: runtime?.login ? () => new Promise((resolve, reject) => runtime.login!({
      timeout: 5000, success: (result) => result.code ? resolve(result.code) : reject(new Error("No login code")), fail: reject
    })) : undefined,
    onResume(callback) {
      runtime?.onShow?.(callback);
      runtime?.onNetworkStatusChange?.((state) => { if (state.isConnected) callback(); });
      if (!runtime && typeof window !== "undefined") {
        window.addEventListener("online", callback);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) callback(); });
      }
    },
    onHide(callback) {
      runtime?.onHide?.(callback);
      if (!runtime && typeof window !== "undefined") {
        window.addEventListener("pagehide", callback);
        document.addEventListener("visibilitychange", () => { if (document.hidden) callback(); });
      }
    }
  };
}
