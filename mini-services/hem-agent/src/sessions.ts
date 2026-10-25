// SessionManager — two-step TOFU connect flow (contract §3):
//   1) POST /api/connect → unknown host key: fingerprint-required (120s park, unauthenticated)
//   2) POST /api/connect/confirm → complete handshake, store fingerprint, full connection
//   Host key mismatch → 409 HOSTKEY_CHANGED (no way through without forget)
// + park TTL, keepalive, sudo detection, and status events.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { HemError } from "./errors";
import { KnownHosts, ProfileStore } from "./profiles";
import { Redactor } from "./redact";
import { SshSession, type HostKeyVerdict } from "./ssh";
import { detectSudoMode } from "./sudo";
import type {
  AuditLoggerLike,
} from "./events";
import type {
  ConnectRequest,
  ConnectResponse,
  ExecOptions,
  ExecResult,
  HostKeyFingerprint,
  KnownHostEntry,
  SessionInfo,
  SessionStatus,
  SudoMode,
} from "./types";
import type { SecretStore } from "./secrets";

export const PARK_TTL_MS = 120_000;

interface ManagedSession {
  id: string;
  state: SessionStatus;
  ssh: SshSession;
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "key";
  /** Memory only — never serialized */
  passwordInMemory?: string;
  sudoMode?: SudoMode;
  profileId?: string;
  hsMode: "system-sudo" | "system" | "custom";
  hsCustomPrefix?: string;
  healthUrl?: string;
  logPath?: string;
  configPath?: string;
  /** How hsctl is invoked on the server (hsctl = on PATH) */
  hsctlPath?: string;
  createdAt: number;
  connectedAt?: number;
  parkedTimer?: ReturnType<typeof setTimeout>;
  presentedFingerprint?: HostKeyFingerprint;
  banner?: string;
  lastError?: string;
}

export interface SessionManagerDeps {
  home: string;
  profiles: ProfileStore;
  secrets: SecretStore;
  audit: AuditLoggerLike;
  redactor: Redactor;
  onStatus?: (sessionId: string, status: "connected" | "disconnected" | "error", detail?: string) => void;
}

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private knownHosts: KnownHosts;
  private deps: SessionManagerDeps;
  private sweeper: ReturnType<typeof setInterval>;

  constructor(deps: SessionManagerDeps) {
    this.deps = deps;
    this.knownHosts = new KnownHosts(deps.home);
    this.sweeper = setInterval(() => this.sweep(), 10_000);
    this.sweeper.unref?.();
  }

  /** Status callback setter (installed by events.ts after io is created) */
  set onStatus(cb: SessionManagerDeps["onStatus"]) {
    this.deps.onStatus = cb;
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => this.toInfo(s));
  }

  get(id: string): SessionInfo | undefined {
    const s = this.sessions.get(id);
    return s ? this.toInfo(s) : undefined;
  }

  /** Run a raw command on a connected session */
  async exec(sessionId: string, cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const s = this.requireConnected(sessionId);
    return s.ssh.exec(cmd, opts);
  }

  /** Run a sudo command on a connected session */
  async execSudo(sessionId: string, cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const s = this.requireConnected(sessionId);
    const mode = s.sudoMode ?? (await this.refreshSudoMode(sessionId));
    return s.ssh.execSudo(cmd, mode, s.passwordInMemory, opts);
  }

  /** Detect/re-detect sudo mode */
  async refreshSudoMode(sessionId: string): Promise<SudoMode> {
    const s = this.requireConnected(sessionId);
    s.sudoMode = await detectSudoMode(s.ssh, {
      username: s.username,
      password: s.passwordInMemory,
    });
    return s.sudoMode;
  }

  /**
   * Two-step connect. 200 on success; fingerprint-required for an unknown key;
   * mismatch → throws HemError HOSTKEY_CHANGED (409) with stored/presented.
   */
  async connect(req: ConnectRequest): Promise<ConnectResponse> {
    const target = await this.resolveCredentials(req);

    // If sessionId is given, the previous session with that id is torn down
    if (req.sessionId) {
      const old = this.sessions.get(req.sessionId);
      if (old) this.teardown(old, "replaced");
    }

    const sessionId = req.sessionId ?? `s-${randomUUID().slice(0, 8)}`;
    // Boxed object — so TypeScript CFA does not discard the value assigned inside the verify closure while keeping it valid
    const mismatchRef: { v: { stored: KnownHostEntry; presented: HostKeyFingerprint } | null } = { v: null };
    const hostKey = `${target.host}:${target.port}`;
    const stored = this.knownHosts.get(target.host, target.port);

    const verify = (fp: HostKeyFingerprint): HostKeyVerdict => {
      if (!stored) {
        // Unknown — unless the user has already accepted the fingerprint
        return req.fingerprintAccept === true ? "accept" : "park";
      }
      if (stored.sha256 === fp.hash) return "accept";
      mismatchRef.v = { stored, presented: fp };
      return "reject";
    };

    const ssh = new SshSession({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      privateKey: target.privateKey,
      passphrase: target.passphrase,
      verifyHostKey: verify,
    });

    const session: ManagedSession = {
      id: sessionId,
      state: "connecting",
      ssh,
      host: target.host,
      port: target.port,
      username: target.username,
      authMethod: target.authMethod,
      passwordInMemory: target.password,
      profileId: target.profileId,
      hsMode: target.hsMode,
      hsCustomPrefix: target.hsCustomPrefix,
      healthUrl: target.healthUrl,
      logPath: target.logPath,
      configPath: target.configPath,
      hsctlPath: target.hsctlPath,
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);

    // Background cleanup on socket close
    ssh.registerCloseHandler(() => {
      const s = this.sessions.get(sessionId);
      if (s && s.state === "connected") {
        s.state = "disconnected";
        this.deps.onStatus?.(sessionId, "disconnected", "اتصال SSH بسته شد.");
        this.deps.audit.log({ sessionId, action: "session_closed", ok: true });
        setTimeout(() => {
          const cur = this.sessions.get(sessionId);
          if (cur && cur.state !== "connected" && cur.state !== "fingerprint-required") {
            this.sessions.delete(sessionId);
          }
        }, 5_000).unref?.();
      } else if (s && s.state === "fingerprint-required") {
        // Server closed while parked
        this.teardown(s, "server-closed-while-parked");
      }
    });
    ssh.registerErrorHandler((err) => {
      const s = this.sessions.get(sessionId);
      if (s && s.state === "connected") {
        s.state = "error";
        s.lastError = err.message;
        this.deps.onStatus?.(sessionId, "error", err.message);
        this.deps.audit.log({ sessionId, action: "session_error", ok: false, error: err.message });
      }
    });

    try {
      const outcome = await ssh.connect();
      if (outcome.kind === "connected") {
        // Only happens when the key was already known or fingerprintAccept was explicit
        if (!stored && req.fingerprintAccept === true) {
          this.knownHosts.set(target.host, target.port, {
            algo: ssh.presentedHostKey!.algo,
            sha256: ssh.presentedHostKey!.hash,
          });
        }
        await this.finalizeConnected(session, ssh.presentedHostKey ?? undefined);
        this.deps.audit.log({
          sessionId,
          action: "connect",
          target: `${target.username}@${target.host}:${target.port} (${target.hsMode})`,
          ok: true,
        });
        return {
          status: "connected",
          sessionId,
          sudoMode: session.sudoMode,
          serverInfo: {
            banner: ssh.bannerText ?? undefined,
            fingerprint: ssh.presentedHostKey ?? undefined,
          },
        };
      }
      // fingerprint-required → park
      session.state = "fingerprint-required";
      session.presentedFingerprint = outcome.fingerprint;
      session.parkedTimer = setTimeout(() => {
        const s = this.sessions.get(sessionId);
        if (s && s.state === "fingerprint-required") {
          this.teardown(s, "park-timeout");
          this.deps.audit.log({
            sessionId,
            action: "connect",
            ok: false,
            error: "مهلت تأیید اثرانگشت (۱۲۰ ثانیه) پایان یافت.",
          });
        }
      }, PARK_TTL_MS);
      this.deps.audit.log({
        sessionId,
        action: "connect",
        target: `${target.username}@${target.host}:${target.port}`,
        ok: true,
        error: "fingerprint-required (TOFU)",
      });
      return { status: "fingerprint-required", sessionId, fingerprint: outcome.fingerprint };
    } catch (e) {
      const mismatch = mismatchRef.v;
      if (mismatch && ssh.hostKeyRejected) {
        this.teardown(session, "hostkey-changed");
        this.deps.audit.log({
          sessionId,
          action: "connect",
          target: hostKey,
          ok: false,
          error: "HOSTKEY_CHANGED — کلید میزبان تغییر کرده است.",
        });
        throw new HemError(
          "HOSTKEY_CHANGED",
          "⚠️ هشدار امنیتی: کلید میزبان سرور با مقدار ذخیره‌شده مغایرت دارد! اتصال قطع شد. اگر مطمئنید سرور reinstall/تعویض کلید شده، ابتدا از «فراموشی کلید میزبان» استفاده کنید و دوباره اثرانگشت جدید را تأیید کنید.",
          { stored: mismatch.stored, presented: mismatch.presented, host: target.host, port: target.port },
        );
      }
      this.teardown(session, "connect-failed");
      const err = e instanceof HemError ? e : new HemError("CONNECT_FAILED", undefined, { reason: String(e) });
      session.lastError = err.message;
      this.deps.audit.log({
        sessionId,
        action: "connect",
        target: `${target.username}@${target.host}:${target.port}`,
        ok: false,
        error: err.message,
      });
      throw err;
    }
  }

  /** Accept/reject the fingerprint of a parked session */
  async confirm(sessionId: string, accept: boolean): Promise<ConnectResponse> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new HemError("NOT_FOUND", "نشست یافت نشد یا منقضی شده است.");
    if (s.state !== "fingerprint-required") {
      throw new HemError("VALIDATION_FAILED", "این نشست در انتظار تأیید اثرانگشت نیست.");
    }
    if (!accept) {
      const fp = s.presentedFingerprint;
      this.teardown(s, "fingerprint-declined");
      this.deps.audit.log({ sessionId, action: "connect_confirm", ok: false, error: "رد اثرانگشت توسط کاربر" });
      void fp;
      return { status: "declined", sessionId };
    }
    if (s.parkedTimer) clearTimeout(s.parkedTimer);
    const fp = s.presentedFingerprint!;
    try {
      await s.ssh.acceptHostKey();
    } catch (e) {
      this.teardown(s, "confirm-failed");
      const err = e instanceof HemError ? e : new HemError("CONNECT_FAILED", undefined, { reason: String(e) });
      this.deps.audit.log({ sessionId, action: "connect_confirm", ok: false, error: err.message });
      throw err;
    }
    this.knownHosts.set(s.host, s.port, { algo: fp.algo, sha256: fp.hash });
    await this.finalizeConnected(s, fp);
    this.deps.audit.log({
      sessionId,
      action: "connect_confirm",
      target: `${s.host}:${s.port} ${fp.algo} ${fp.hash}`,
      ok: true,
    });
    return {
      status: "connected",
      sessionId,
      sudoMode: s.sudoMode,
      serverInfo: { banner: s.ssh.bannerText ?? undefined, fingerprint: fp },
    };
  }

  disconnect(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) throw new HemError("NOT_FOUND", "نشست یافت نشد.");
    this.teardown(s, "user-disconnect");
    this.deps.audit.log({ sessionId, action: "disconnect", target: `${s.host}:${s.port}`, ok: true });
  }

  /** Close all sessions (agent shutdown) */
  closeAll(): void {
    for (const s of [...this.sessions.values()]) this.teardown(s, "shutdown");
  }

  dispose(): void {
    clearInterval(this.sweeper);
    this.closeAll();
  }

  /** headscale execution context for a session (consumers: api/remote) */
  hsContext(sessionId: string): {
    sessionId: string;
    ssh: SshSession;
    hsMode: "system-sudo" | "system" | "custom";
    hsCustomPrefix?: string;
    sudoMode?: SudoMode;
    sudoPassword?: string;
    username: string;
    healthUrl?: string;
    logPath?: string;
    configPath?: string;
    hsctlPath?: string;
    refreshSudo: () => Promise<SudoMode>;
  } {
    const s = this.requireConnected(sessionId);
    return {
      sessionId: s.id,
      ssh: s.ssh,
      hsMode: s.hsMode,
      hsCustomPrefix: s.hsCustomPrefix,
      sudoMode: s.sudoMode,
      sudoPassword: s.passwordInMemory,
      username: s.username,
      healthUrl: s.healthUrl,
      logPath: s.logPath,
      configPath: s.configPath,
      hsctlPath: s.hsctlPath,
      refreshSudo: () => this.refreshSudoMode(s.id),
    };
  }

  requireConnected(sessionId: string): ManagedSession & { ssh: SshSession } {
    const s = this.sessions.get(sessionId);
    if (!s) throw new HemError("NOT_FOUND", "نشست یافت نشد. ابتدا متصل شوید.");
    if (s.state === "fingerprint-required") {
      throw new HemError("FINGERPRINT_REQUIRED", "نشست در انتظار تأیید اثرانگشت کلید میزبان است.");
    }
    if (s.state !== "connected") {
      throw new HemError("NOT_CONNECTED", "نشست متصل نیست؛ دوباره اتصال برقرار کنید.");
    }
    return s as ManagedSession & { ssh: SshSession };
  }

  /** List known host keys (TOFU) */
  knownHostsList(): Record<string, KnownHostEntry> {
    return this.knownHosts.list();
  }

  /** Forget a host key — the only way past HOSTKEY_CHANGED */
  forgetKnownHost(host: string, port: number): boolean {
    return this.knownHosts.forget(host, port);
  }

  // ---------------------------------------------------------------------------

  private async finalizeConnected(session: ManagedSession, fingerprint?: HostKeyFingerprint): Promise<void> {
    session.state = "connected";
    session.connectedAt = Date.now();
    session.presentedFingerprint = fingerprint ?? session.presentedFingerprint;
    session.banner = session.ssh.bannerText ?? undefined;
    // Register secrets for defensive log redaction
    this.deps.redactor.registerSecret(session.passwordInMemory);
    // Detect sudo (non-critical)
    try {
      session.sudoMode = await detectSudoMode(session.ssh, {
        username: session.username,
        password: session.passwordInMemory,
      });
    } catch {
      session.sudoMode = "none";
    }
    this.deps.onStatus?.(session.id, "connected", `متصل به ${session.host}:${session.port}`);
  }

  private teardown(session: ManagedSession, reason: string): void {
    if (session.parkedTimer) clearTimeout(session.parkedTimer);
    session.parkedTimer = undefined;
    try {
      session.ssh.close();
    } catch {
      /* ignore */
    }
    const wasConnected = session.state === "connected";
    session.state = "disconnected";
    session.lastError = session.lastError ?? reason;
    this.sessions.delete(session.id);
    if (wasConnected) {
      this.deps.onStatus?.(session.id, "disconnected", reason);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const s of [...this.sessions.values()]) {
      if (s.state === "fingerprint-required" && now - s.createdAt > PARK_TTL_MS + 5_000) {
        this.teardown(s, "park-timeout");
      } else if (s.state === "disconnected" || s.state === "error") {
        this.sessions.delete(s.id);
      }
    }
  }

  private toInfo(s: ManagedSession): SessionInfo {
    return {
      id: s.id,
      status: s.state,
      host: s.host,
      port: s.port,
      username: s.username,
      authMethod: s.authMethod,
      profileId: s.profileId,
      hsMode: s.hsMode,
      sudoMode: s.sudoMode,
      createdAt: new Date(s.createdAt).toISOString(),
      connectedAt: s.connectedAt ? new Date(s.connectedAt).toISOString() : undefined,
      fingerprint: s.presentedFingerprint,
      lastError: s.lastError,
    };
  }

  private async resolveCredentials(req: ConnectRequest): Promise<{
    host: string;
    port: number;
    username: string;
    authMethod: "password" | "key";
    password?: string;
    privateKey?: string;
    passphrase?: string;
    profileId?: string;
    hsMode: "system-sudo" | "system" | "custom";
    hsCustomPrefix?: string;
    healthUrl?: string;
    logPath?: string;
    configPath?: string;
    hsctlPath?: string;
  }> {
    if (req.profileId) {
      const profile = this.deps.profiles.get(req.profileId);
      if (!profile) throw new HemError("NOT_FOUND", "پروفایل یافت نشد.");
      const secretKey = `profile:${profile.id}`;
      const secret = this.deps.secrets.get(secretKey);
      let password: string | undefined;
      let passphrase: string | undefined;
      if (profile.authMethod === "password") password = secret;
      else passphrase = secret;
      let privateKey: string | undefined;
      if (profile.authMethod === "key") {
        if (!profile.keyPath) {
          throw new HemError("VALIDATION_FAILED", "پروفایل کلید دارد اما مسیر فایل کلید تعیین نشده است.");
        }
        try {
          privateKey = readFileSync(profile.keyPath, "utf8");
        } catch {
          throw new HemError("VALIDATION_FAILED", `خواندن فایل کلید محلی ناموفق بود: ${profile.keyPath}`);
        }
      }
      if (profile.authMethod === "password" && !password) {
        throw new HemError(
          "VALIDATION_FAILED",
          "رمز عبور این پروفایل ذخیره نشده است؛ هنگام اتصال رمز را بدهید (inline) یا آن را ذخیره کنید.",
        );
      }
      return {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        authMethod: profile.authMethod,
        password,
        privateKey,
        passphrase,
        profileId: profile.id,
        hsMode: profile.hsMode,
        hsCustomPrefix: profile.hsCustomPrefix,
        healthUrl: profile.healthUrl,
        logPath: profile.logPath,
        configPath: profile.configPath,
        hsctlPath: profile.hsctlPath,
      };
    }

    const inline = req.inline;
    if (!inline) {
      throw new HemError("VALIDATION_FAILED", "یا profileId یا inline برای اتصال لازم است.");
    }
    if (!inline.host?.trim() || !inline.username?.trim()) {
      throw new HemError("VALIDATION_FAILED", "host و username الزامی هستند.");
    }
    const port = inline.port ?? 22;
    let password = inline.password;
    let passphrase = inline.passphrase;
    let privateKey = inline.keyContent;
    if (inline.authMethod === "key" && !privateKey && inline.keyPath) {
      try {
        privateKey = readFileSync(inline.keyPath, "utf8");
      } catch {
        throw new HemError("VALIDATION_FAILED", `خواندن فایل کلید محلی ناموفق بود: ${inline.keyPath}`);
      }
    }
    if (inline.authMethod === "password" && !password) {
      throw new HemError("VALIDATION_FAILED", "برای احراز هویت با رمز، password الزامی است.");
    }
    if (inline.authMethod === "key" && !privateKey) {
      throw new HemError("VALIDATION_FAILED", "برای احراز هویت با کلید، keyContent یا keyPath الزامی است.");
    }
    return {
      host: inline.host,
      port,
      username: inline.username,
      authMethod: inline.authMethod,
      password,
      privateKey,
      passphrase,
      hsMode: inline.hsMode ?? "system-sudo",
      hsCustomPrefix: inline.hsCustomPrefix,
      healthUrl: inline.healthUrl,
      logPath: inline.logPath,
      configPath: inline.configPath,
      hsctlPath: inline.hsctlPath,
    };
  }
}
