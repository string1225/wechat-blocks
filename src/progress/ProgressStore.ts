import { createProgressPlatform, type ProgressPlatform } from "./platform";
import { isGameProgress, type GameProgress } from "./schema";

interface LocalSave {
  version: 1;
  token?: string;
  kind?: "guest" | "wechat";
  player?: string;
  revision: number;
  progress: GameProgress | null;
  mutation: string | null;
  pending?: { revision: number; mutation: string; progress: GameProgress };
}

// A single serialized writer, revision checks and idempotent mutations prevent
// delayed requests or another device from silently overwriting newer progress.
export class ProgressStore {
  private state: LocalSave = { version: 1, revision: 0, progress: null, mutation: null };
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 2000;
  private connected = false;
  private initialized = false;
  private wechatAuthenticated = false;
  private disposed = false;
  private onRemote: ((progress: GameProgress | null) => void) | null = null;

  constructor(private readonly platform: ProgressPlatform = createProgressPlatform()) {
    try {
      const saved = JSON.parse(platform.read() || "null") as LocalSave | null;
      if (saved?.version === 1 && Number.isInteger(saved.revision) && saved.revision >= 0
        && (saved.progress === null || isGameProgress(saved.progress))
        && (saved.token === undefined || /^[a-f0-9]{64}$/.test(saved.token))
        && (saved.mutation === null || typeof saved.mutation === "string")
        && (!saved.pending || (Number.isInteger(saved.pending.revision) && saved.pending.revision >= 0
          && typeof saved.pending.mutation === "string" && isGameProgress(saved.pending.progress)))) this.state = saved;
    } catch { /* Ignore an incompatible or damaged cache. */ }
    platform.onHide(() => { if (this.initialized) void this.flush(); });
    platform.onResume(() => {
      if (this.initialized) { this.connected = false; this.wechatAuthenticated = false; void this.flush(); }
    });
  }

  get current(): GameProgress | null { return this.state.progress; }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async connect(onRemote: (progress: GameProgress | null) => void): Promise<GameProgress | null> {
    this.onRemote = onRemote;
    await this.flush();
    this.initialized = true;
    return this.current;
  }

  save(progress: GameProgress): void {
    if (JSON.stringify(this.state.progress) === JSON.stringify(progress)) return;
    this.state.progress = progress;
    this.state.mutation = mutationId();
    this.persist(); // Synchronous local write also covers exit during an animation.
    this.schedule(200);
  }

  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.running) return this.running;
    this.running = this.synchronize().catch(() => {
      this.connected = false;
      this.schedule(this.retryDelay);
      this.retryDelay = Math.min(60000, this.retryDelay * 2);
    }).finally(() => { this.running = null; });
    return this.running;
  }

  private async synchronize(): Promise<void> {
    if (!this.connected) {
      await this.authenticate();
      // Retry a pending write before reading: a lost response may already have
      // committed this mutation, in which case the server acknowledges it once.
      if (!this.state.mutation && !this.state.pending) {
        const response = await this.platform.request("/progress", "GET", this.state.token);
        this.checkStatus(response.status);
        this.acceptRemote(response.data, false);
      }
      this.connected = true;
    }
    while (this.state.pending || (this.state.mutation && this.state.progress)) {
      this.state.pending ??= {
        revision: this.state.revision, mutation: this.state.mutation!, progress: this.state.progress!
      };
      this.persist();
      const { mutation } = this.state.pending;
      const response = await this.platform.request("/progress", "PUT", this.state.token, this.state.pending);
      if (response.status === 409) {
        this.platform.backup(JSON.stringify(this.state));
        this.acceptRemote(response.data, true);
        break;
      }
      this.checkStatus(response.status);
      if (!Number.isInteger(response.data.revision)) throw new Error("Invalid save response");
      this.state.revision = response.data.revision;
      this.state.pending = undefined;
      if (this.state.mutation === mutation) this.state.mutation = null;
      this.persist();
    }
    this.retryDelay = 2000;
  }

  private async authenticate(): Promise<void> {
    if (this.platform.login && !this.wechatAuthenticated) {
      const code = await this.platform.login();
      const response = await this.platform.request("/session/wechat", "POST", this.state.token, { code });
      if (response.status === 200) {
        const switchedAccount = this.state.kind === "wechat" && this.state.player !== response.data.player;
        const upgradingGuest = this.state.kind !== "wechat";
        if (switchedAccount || (upgradingGuest && response.data.progress)) {
          if (this.state.progress) this.platform.backup(JSON.stringify(this.state));
          this.acceptRemote(response.data, true);
        } else if (upgradingGuest) {
          this.state.revision = 0;
          this.state.pending = undefined;
          if (this.state.progress) this.state.mutation = mutationId();
        }
        this.useSession(response.data, "wechat");
        this.wechatAuthenticated = true;
      } else if (response.status !== 503) {
        throw new Error("WeChat login failed");
      } else this.wechatAuthenticated = true;
    }
    if (!this.state.token) {
      const response = await this.platform.request("/session/guest", "POST");
      this.checkStatus(response.status);
      this.state.revision = 0;
      this.state.pending = undefined;
      if (this.state.progress) this.state.mutation = mutationId();
      this.useSession(response.data, "guest");
    }
  }

  private useSession(data: { token: unknown; player: unknown }, kind: "guest" | "wechat"): void {
    if (typeof data.token !== "string" || !/^[a-f0-9]{64}$/.test(data.token)
      || typeof data.player !== "string" || !/^[a-f0-9]{64}$/.test(data.player)) throw new Error("Invalid session");
    this.state.token = data.token;
    this.state.player = data.player;
    this.state.kind = kind;
    this.persist();
  }

  private acceptRemote(data: { revision: number; progress: unknown }, discardPending: boolean): void {
    if (!Number.isInteger(data.revision) || data.revision < 0
      || (data.progress !== null && !isGameProgress(data.progress))) throw new Error("Invalid remote save");
    if (this.state.mutation && !discardPending) return;
    this.state.revision = data.revision;
    this.state.mutation = null;
    this.state.pending = undefined;
    this.state.progress = data.progress as GameProgress | null;
    if (this.initialized) this.onRemote?.(this.state.progress);
    this.persist();
  }

  private checkStatus(status: number): void {
    if (status === 401) {
      this.state.token = undefined;
      this.wechatAuthenticated = false;
      this.persist();
    }
    if (status < 200 || status >= 300) throw new Error(`Progress request failed (${status})`);
  }

  private persist(): void { this.platform.write(JSON.stringify(this.state)); }
  private schedule(delay: number): void {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delay);
  }
}

function mutationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
