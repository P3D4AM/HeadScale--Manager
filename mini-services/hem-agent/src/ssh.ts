// SshSession — a wrapper over the ssh2 Client with:
//  - password/key connect (+passphrase), readyTimeout and keepalive
//  - host key verification hook (SHA256 + MD5 fingerprints) with park support for two-step TOFU
//  - exec with live streaming, timeout, and channel kill on timeout
//  - execSudo: password only via stdin (never in argv)
//  - readFile/writeFile via base64 (chunks ≤48KB)

import { Client } from "ssh2";
import { createHash, randomBytes } from "node:crypto";
import { HemError } from "./errors";
import type { ExecOptions, ExecResult, HostKeyFingerprint } from "./types";

export type HostKeyVerdict = "accept" | "reject" | "park";

export type ConnectOutcome =
  | { kind: "connected"; banner?: string }
  | { kind: "fingerprint-required"; fingerprint: HostKeyFingerprint };

export interface SshSessionOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** Host key decider — if unset everything is accepted (tests only) */
  verifyHostKey?: (fp: HostKeyFingerprint) => HostKeyVerdict;
  /** Post-connect error (used to update session status) */
  onConnectedError?: (err: Error) => void;
  onClose?: () => void;
  onBanner?: (banner: string) => void;
}

/** Safely quote one argument for building a shell string */
export function shellQuote(s: string): string {
  if (s.length === 0) return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Extract the key algorithm from the wire-format blob (len4 + name + body) */
function algoOfWireBlob(raw: Buffer): string {
  try {
    if (raw.length > 8) {
      const nameLen = raw.readUInt32BE(0);
      if (nameLen > 0 && nameLen <= 64 && 4 + nameLen <= raw.length) {
        const algo = raw.subarray(4, 4 + nameLen).toString("utf8");
        if (/^[a-z0-9@.\-]+$/i.test(algo)) return algo;
      }
    }
  } catch {
    // ignored — the algorithm stays unknown
  }
  return "unknown";
}

/** Host key fingerprint: OpenSSH-style SHA256(base64) + MD5 hex */
export function fingerprintOf(rawKey: Buffer): HostKeyFingerprint {
  const sha256 = `SHA256:${createHash("sha256").update(rawKey).digest("base64")}`;
  const md5 = createHash("md5")
    .update(rawKey)
    .digest("hex")
    .toUpperCase()
    .match(/../g)
    ?.join(":");
  return { algo: algoOfWireBlob(rawKey), hash: sha256, base64Md5: md5 ?? "" };
}

const READY_TIMEOUT_MS = 15_000;
const KEEPALIVE_MS = 15_000;

export class SshSession {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  /** Host key fingerprint presented on this connection */
  presentedHostKey: HostKeyFingerprint | null = null;
  /** Set when verifyHostKey voted reject (mismatch) — the session manager converts it to HOSTKEY_CHANGED */
  hostKeyRejected = false;

  private client: Client;
  private opts: SshSessionOptions;
  private parked = false;
  private pendingVerify: ((ok: boolean) => void) | null = null;
  private closed = false;
  private banner: string | null = null;
  private readyResolve!: () => void;
  private readyReject!: (e: Error) => void;
  /** After acceptHostKey, callers wait on this promise until ready */
  readonly readyPromise: Promise<void>;

  constructor(opts: SshSessionOptions) {
    this.opts = opts;
    this.host = opts.host;
    this.port = opts.port;
    this.username = opts.username;
    this.client = new Client();
    this.readyPromise = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
    // Prevent unhandledRejection when nobody awaits ready
    this.readyPromise.catch(() => undefined);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Server banner text (if sent) */
  get bannerText(): string | null {
    return this.banner;
  }

  private closeHandlers = new Set<() => void>();
  private errorHandlers = new Set<(e: Error) => void>();

  /** Register a close callback (SessionManager updates session status) */
  registerCloseHandler(fn: () => void): void {
    this.closeHandlers.add(fn);
  }

  /** Register a post-connect error callback */
  registerErrorHandler(fn: (e: Error) => void): void {
    this.errorHandlers.add(fn);
  }

  /**
   * Connect. Outcome:
   *  - connected: handshake + full authentication
   *  - fingerprint-required: unknown host key; the session is parked (half-open, unauthenticated)
   *    waiting for acceptHostKey()/rejectHostKey().
   * Note: the ssh2 built-in readyTimeout is disabled because its timer kills the TOFU park;
   * we apply the 15s connect deadline ourselves (race) which resolves earlier on park.
   */
  connect(): Promise<ConnectOutcome> {
    return new Promise<ConnectOutcome>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const handshakeTimer = setTimeout(() => {
        finish(() => {
          this.client.end();
          reject(
            new HemError("CONNECT_TIMEOUT", "اتصال به سرور در ۱۵ ثانیه برقرار نشد.", {
              host: this.host,
              port: this.port,
            }),
          );
        });
      }, READY_TIMEOUT_MS);
      const clearHandshakeTimer = () => clearTimeout(handshakeTimer);

      this.client
        .on("banner", (b: string) => {
          this.banner = b;
          this.opts.onBanner?.(b);
        })
        .on("ready", () => {
          clearHandshakeTimer();
          this.readyResolve();
          if (!this.parked) {
            finish(() => resolve({ kind: "connected", banner: this.banner ?? undefined }));
          }
          // If parked: resolve already returned fingerprint-required and
          // whoever called acceptHostKey is waiting on readyPromise.
        })
        .on("error", (err: Error) => {
          clearHandshakeTimer();
          const mapped = this.mapConnectError(err);
          this.readyReject(mapped);
          if (!settled) {
            finish(() => {
              this.client.end();
              reject(mapped);
            });
          } else {
            this.opts.onConnectedError?.(err);
            for (const h of [...this.errorHandlers]) {
              try {
                h(err);
              } catch {
                /* a handler must not kill the agent */
              }
            }
          }
        })
        .on("close", () => {
          clearHandshakeTimer();
          if (!this.closed) {
            this.closed = true;
            this.opts.onClose?.();
            for (const h of [...this.closeHandlers]) {
              try {
                h();
              } catch {
                /* a handler must not kill the agent */
              }
            }
          }
          this.readyReject(new HemError("NOT_CONNECTED", "اتصال SSH بسته شد."));
          if (!settled) {
            finish(() =>
              reject(new HemError("CONNECT_FAILED", "اتصال به سرور بسته شد قبل از تکمیل دست‌دهی.", {
                host: this.host,
                port: this.port,
              })),
            );
          }
        });

      const connectOpts: Record<string, unknown> = {
        host: this.opts.host,
        port: this.opts.port,
        username: this.opts.username,
        readyTimeout: 0, // built-in timer disabled — the TOFU park must not die immediately
        keepaliveInterval: KEEPALIVE_MS,
        hostVerifier: (key: Buffer, verify: (ok: boolean) => void): void => {
          const fp = fingerprintOf(key);
          this.presentedHostKey = fp;
          const verdict = this.opts.verifyHostKey ? this.opts.verifyHostKey(fp) : "accept";
          if (verdict === "accept") {
            verify(true);
            return;
          }
          if (verdict === "reject") {
            this.hostKeyRejected = true;
            verify(false);
            return;
          }
          // park — waiting for the explicit user decision (the 120s cap is enforced by SessionManager)
          this.parked = true;
          this.pendingVerify = verify;
          clearHandshakeTimer();
          finish(() => resolve({ kind: "fingerprint-required", fingerprint: fp }));
        },
      };
      if (this.opts.password !== undefined) connectOpts.password = this.opts.password;
      if (this.opts.privateKey !== undefined) connectOpts.privateKey = this.opts.privateKey;
      if (this.opts.passphrase !== undefined) connectOpts.passphrase = this.opts.passphrase;

      try {
        this.client.connect(connectOpts as Parameters<Client["connect"]>[0]);
      } catch (e) {
        // ssh2 throws some errors synchronously (e.g. wrong passphrase)
        clearHandshakeTimer();
        const mapped = this.mapConnectError(e instanceof Error ? e : new Error(String(e)));
        this.readyReject(mapped);
        finish(() => {
          try {
            this.client.end();
          } catch {
            /* ignore */
          }
          reject(mapped);
        });
      }
    });
  }

  private mapConnectError(err: Error): HemError {
    const msg = String(err?.message ?? err);
    if (this.hostKeyRejected) {
      return new HemError(
        "HOSTKEY_CHANGED",
        "کلید میزبان سرور با مقدار ذخیره‌شده مغایرت دارد؛ اتصال رد شد.",
      );
    }
    if (/All configured authentication methods failed/i.test(msg)) {
      return new HemError("AUTH_FAILED", undefined, { sshMessage: msg });
    }
    if (/Cannot parse privateKey|Bad passphrase|Invalid private key/i.test(msg)) {
      return new HemError("AUTH_FAILED", "کلید خصوصی یا عبارت عبور (passphrase) آن نامعتبر است.", {
        sshMessage: msg,
      });
    }
    if (/timed out/i.test(msg) || /ETIMEDOUT/.test(msg)) {
      return new HemError("CONNECT_TIMEOUT", undefined, { sshMessage: msg });
    }
    if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET|EPIPE/.test(msg)) {
      return new HemError("CONNECT_FAILED", undefined, { sshMessage: msg });
    }
    return new HemError("CONNECT_FAILED", undefined, { sshMessage: msg });
  }

  /** Accept the parked host key → resume handshake and authentication */
  acceptHostKey(): Promise<void> {
    if (!this.pendingVerify) {
      return this.closed
        ? Promise.reject(new HemError("NOT_CONNECTED", "نشست قبلاً بسته شده است."))
        : Promise.resolve();
    }
    const verify = this.pendingVerify;
    this.pendingVerify = null;
    verify(true);
    // guard timeout after acceptance (the handshake should complete within seconds)
    return Promise.race([
      this.readyPromise,
      new Promise<never>((_, rej) =>
        setTimeout(
          () =>
            rej(
              new HemError(
                "CONNECT_TIMEOUT",
                "پس از تأیید اثرانگشت، تکمیل اتصال بیش از حد انتظار طول کشید.",
              ),
            ),
          20_000,
        ),
      ),
    ]);
  }

  /** Reject the parked host key → close the connection */
  rejectHostKey(): void {
    const verify = this.pendingVerify;
    this.pendingVerify = null;
    if (verify) verify(false);
    this.close();
  }

  /** Run a command with streaming, timeout, and channel kill on timeout */
  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (this.closed) {
      throw new HemError("NOT_CONNECTED", "نشست SSH بسته است؛ دوباره متصل شوید.");
    }
    const timeoutMs = opts.timeoutMs ?? 30_000;
    return new Promise<ExecResult>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      let settled = false;
      // ssh2 interop: the stream type in @types is old; the fields match the runtime.
      let stream: {
        on: (ev: string, fn: (d?: Buffer) => void) => void;
        stderr: { on: (ev: string, fn: (d?: Buffer) => void) => void };
        end: (data?: string | Buffer) => void;
        close: () => void;
        signal?: (s: string) => void;
      } | null = null;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Kill the channel: signal first, then close — the server-side child must die
        try {
          stream?.signal?.("KILL");
        } catch {
          /* best-effort */
        }
        try {
          stream?.close();
        } catch {
          /* best-effort */
        }
        reject(
          new HemError("EXEC_FAILED", `مهلت اجرای دستور (${Math.round(timeoutMs / 1000)} ثانیه) به پایان رسید.`, {
            timedOut: true,
            cmd,
          }),
        );
      }, timeoutMs);

      this.client.exec(cmd, (err, s) => {
        if (err) {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            reject(new HemError("EXEC_FAILED", "باز کردن کانال اجرا ناموفق بود.", { reason: err.message }));
          }
          return;
        }
        stream = s as unknown as NonNullable<typeof stream>;
        this.activeChannels.add(stream);
        s.on("data", (d: Buffer) => {
          const text = d.toString("utf8");
          stdout += text;
          opts.onStdout?.(text);
        });
        s.stderr.on("data", (d: Buffer) => {
          const text = d.toString("utf8");
          stderr += text;
          opts.onStderr?.(text);
        });
        if (opts.stdin !== undefined) {
          s.end(opts.stdin);
        } else {
          s.end();
        }
        s.on("exit", (code: number | null) => {
          exitCode = code;
        });
        s.on("close", () => {
          this.activeChannels.delete(stream!);
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolve({ code: exitCode, stdout, stderr });
          }
        });
      });
    });
  }

  /** Active exec channels — for job cancellation (INT signal + channel close) */
  private activeChannels = new Set<{
    signal?: (s: string) => void;
    close: () => void;
  }>();

  /**
   * Cancellable exec (for live jobs). cancel(): tries SIGINT then closes the open channel —
   * the server-side child dies and the result returns with cancelled:true (or an EXEC_FAILED error).
   */
  execCancellable(
    cmd: string,
    opts: ExecOptions = {},
  ): { result: Promise<ExecResult & { cancelled?: boolean }>; cancel: () => void } {
    let cancelled = false;
    const result = this.exec(cmd, opts).then(
      (r) => (cancelled ? { ...r, cancelled: true } : r),
      (e) => {
        if (cancelled && e instanceof HemError) {
          throw new HemError("EXEC_FAILED", "اجرای دستور به درخواست کاربر لغو شد.", { cancelled: true });
        }
        throw e;
      },
    );
    const cancel = () => {
      cancelled = true;
      for (const ch of [...this.activeChannels]) {
        try {
          ch.signal?.("INT");
        } catch {
          /* best-effort */
        }
        try {
          ch.close();
        } catch {
          /* best-effort */
        }
      }
    };
    return { result, cancel };
  }

  /**
   * Run a command with sudo:
   *  - root: no sudo
   *  - nopasswd: sudo -n <cmd>
   *  - password: sudo -S -p '' <cmd> — password via stdin only, never in argv
   *  - none: SUDO_REQUIRED error
   */
  async execSudo(
    cmd: string,
    sudoMode: "root" | "nopasswd" | "password" | "none",
    sudoPassword: string | undefined,
    opts: ExecOptions = {},
  ): Promise<ExecResult> {
    if (sudoMode === "root") return this.exec(cmd, opts);
    if (sudoMode === "nopasswd") return this.exec(`sudo -n ${cmd}`, opts);
    if (sudoMode === "password") {
      if (!sudoPassword) {
        throw new HemError("SUDO_REQUIRED", "رمز sudo در حافظهٔ نشست موجود نیست.");
      }
      return this.exec(`sudo -S -p '' ${cmd}`, { ...opts, stdin: sudoPassword + "\n" });
    }
    throw new HemError(
      "SUDO_REQUIRED",
      "برای این عملیات sudo لازم است اما روی این سرور در دسترس نیست.",
    );
  }

  /** Binary-safe file read from the server (base64) */
  async readFile(path: string, timeoutMs = 20_000): Promise<Buffer> {
    const res = await this.exec(`base64 -w0 ${shellQuote(path)}`, { timeoutMs });
    if (res.code !== 0) {
      throw new HemError("EXEC_FAILED", "خواندن فایل از سرور ناموفق بود.", {
        path,
        stderr: res.stderr.trim(),
      });
    }
    return Buffer.from(res.stdout.trim(), "base64");
  }

  /** Write a file on the server via chunked base64 (each chunk ≤ 24K chars — the SSH packet limit) */
  async writeFile(path: string, content: Buffer | string, timeoutMs = 30_000): Promise<void> {
    const b64 = Buffer.from(content).toString("base64");
    // Max chunk size: the command string must fit in one SSH transport packet (~32KB) —
    // 48K chars effectively produced Unable to exec and killed the connection (a real bug, fixed this session).
    const CHUNK = 24_000; // base64 chars (≈ 18KB raw data per chunk)
    const q = shellQuote(path);
    for (let i = 0; i < b64.length; i += CHUNK) {
      const part = b64.slice(i, i + CHUNK);
      const op = i === 0 ? ">" : ">>";
      const res = await this.exec(`printf '%s' '${part}' | base64 -d ${op} ${q}`, { timeoutMs });
      if (res.code !== 0) {
        throw new HemError("EXEC_FAILED", "نوشتن فایل روی سرور ناموفق بود.", {
          path,
          chunk: Math.floor(i / CHUNK),
          stderr: res.stderr.trim(),
        });
      }
    }
    // empty file
    if (b64.length === 0) {
      const res = await this.exec(`: > ${q}`, { timeoutMs });
      if (res.code !== 0) {
        throw new HemError("EXEC_FAILED", "نوشتن فایل خالی روی سرور ناموفق بود.", { path });
      }
    }
  }

  /** Unique temp file name on the server (under /tmp) — the extension matters because headscale/viper reads the file type from it */
  static remoteTempName(prefix = "hem", ext = ""): string {
    return `/tmp/${prefix}-${randomBytes(6).toString("hex")}${ext}`;
  }

  close(): void {
    if (this.closed && !this.pendingVerify) {
      try {
        this.client.end();
      } catch {
        /* ignore */
      }
      return;
    }
    const verify = this.pendingVerify;
    this.pendingVerify = null;
    if (verify) verify(false);
    this.closed = true;
    try {
      this.client.end();
    } catch {
      /* ignore */
    }
    // final safety net
    setTimeout(() => {
      try {
        this.client.destroy();
      } catch {
        /* ignore */
      }
    }, 2_000).unref?.();
  }
}
