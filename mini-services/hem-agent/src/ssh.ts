// SshSession — پوشش ssh2 Client با:
//  - اتصال password/کلید (+passphrase)، readyTimeout و keepalive
//  - hook بررسی کلید میزبان (اثرانگشت SHA256 + MD5) با قابلیت «پارک» برای TOFU دو مرحله‌ای
//  - exec با استریم زنده، مهلت زمانی و کشتن کانال در timeout
//  - execSudo: رمز فقط از stdin (هرگز در argv)
//  - readFile/writeFile با base64 (چانک‌های ≤48KB)

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
  /** تصمیم‌گیرندهٔ کلید میزبان — اگر تعیین نشود همه‌چیز پذیرفته می‌شود (فقط برای تست) */
  verifyHostKey?: (fp: HostKeyFingerprint) => HostKeyVerdict;
  /** خطای بعد از اتصال (برای به‌روزرسانی وضعیت نشست) */
  onConnectedError?: (err: Error) => void;
  onClose?: () => void;
  onBanner?: (banner: string) => void;
}

/** quoting امن یک آرگومان برای ساخت رشتهٔ شل */
export function shellQuote(s: string): string {
  if (s.length === 0) return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** استخراج الگوریتم کلید از بلاب wire-format (طول۴ + نام + بدنه) */
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
    // نادیده — الگوریتم نامشخص می‌ماند
  }
  return "unknown";
}

/** اثرانگشت کلید میزبان: SHA256(base64) به سبک OpenSSH + MD5 hex */
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
  /** اثرانگشت کلید میزبان ارائه‌شده در این اتصال */
  presentedHostKey: HostKeyFingerprint | null = null;
  /** وقتی verifyHostKey رأی «reject» داده (مغایرت) — مدیر نشست آن را به HOSTKEY_CHANGED تبدیل می‌کند */
  hostKeyRejected = false;

  private client: Client;
  private opts: SshSessionOptions;
  private parked = false;
  private pendingVerify: ((ok: boolean) => void) | null = null;
  private closed = false;
  private banner: string | null = null;
  private readyResolve!: () => void;
  private readyReject!: (e: Error) => void;
  /** پس از acceptHostKey با این پرامیس تا ready صبر می‌شود */
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
    // جلوگیری از unhandledRejection وقتی کسی منتظر ready نیست
    this.readyPromise.catch(() => undefined);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** متن banner سرور (در صورت ارسال) */
  get bannerText(): string | null {
    return this.banner;
  }

  private closeHandlers = new Set<() => void>();
  private errorHandlers = new Set<(e: Error) => void>();

  /** ثبت callback بسته‌شدن اتصال (SessionManager وضعیت نشست را به‌روز می‌کند) */
  registerCloseHandler(fn: () => void): void {
    this.closeHandlers.add(fn);
  }

  /** ثبت callback خطای بعد از اتصال */
  registerErrorHandler(fn: (e: Error) => void): void {
    this.errorHandlers.add(fn);
  }

  /**
   * اتصال. نتیجه:
   *  - connected: handshake + احراز هویت کامل
   *  - fingerprint-required: کلید میزبان ناشناخته؛ نشست «پارک» شده (نیمه‌کاره، بدون احراز هویت) و
   *    منتظر acceptHostKey()/rejectHostKey() است.
   * نکته: readyTimeout داخلی ssh2 را غیرفعال کردیم چون تایمر آن پارک TOFU را می‌کشد؛
   * مهلت ۱۵ ثانیه‌ای اتصال را خودمان اعمال می‌کنیم (race) که با park زودتر از آن تمام می‌شود.
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
          // اگر پارک بوده: resolve قبلاً با fingerprint-required انجام شده و
          // کسی که acceptHostKey صدا زده، منتظر readyPromise است.
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
                /* handler نباید agent را بکشد */
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
                /* handler نباید agent را بکشد */
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
        readyTimeout: 0, // تایمر داخلی غیرفعال — پارک TOFU نباید بلافاصله بمیرد
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
          // park — منتظر تصمیم صریح کاربر (حداکثر ۱۲۰ ثانیه را SessionManager اعمال می‌کند)
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
        // ssh2 برخی خطاها (مثل passphrase نادرست) را همگام پرتاب می‌کند
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

  /** تأیید کلید میزبان پارک‌شده → ادامهٔ handshake و احراز هویت */
  acceptHostKey(): Promise<void> {
    if (!this.pendingVerify) {
      return this.closed
        ? Promise.reject(new HemError("NOT_CONNECTED", "نشست قبلاً بسته شده است."))
        : Promise.resolve();
    }
    const verify = this.pendingVerify;
    this.pendingVerify = null;
    verify(true);
    // مهلت محافظ پس از تأیید (handshake باید ظرف چند ثانیه کامل شود)
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

  /** رد کلید میزبان پارک‌شده → بستن اتصال */
  rejectHostKey(): void {
    const verify = this.pendingVerify;
    this.pendingVerify = null;
    if (verify) verify(false);
    this.close();
  }

  /** اجرای دستور با استریم، مهلت زمانی و کشتن کانال در timeout */
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
      // ssh2 interop: نوع stream در @types قدیمی است؛ فیلدها با runtime سازگارند.
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
        // کشتن کانال: اول سیگنال، بعد بستن — فرزند سمت سرور باید بمیرد
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

  /** کانال‌های exec فعال — برای لغو job ها (سیگنال INT + بستن کانال) */
  private activeChannels = new Set<{
    signal?: (s: string) => void;
    close: () => void;
  }>();

  /**
   * exec قابل‌لغو (برای job های زنده). cancel(): تلاش برای SIGINT و سپس بستن کانال باز —
   * فرزند سمت سرور می‌میرد و نتیجه با cancelled:true (یا خطای EXEC_FAILED) برمی‌گردد.
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
   * اجرای دستور با sudo:
   *  - root: بدون sudo
   *  - nopasswd: sudo -n <cmd>
   *  - password: sudo -S -p '' <cmd> — رمز فقط از stdin، هرگز در argv
   *  - none: خطای SUDO_REQUIRED
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

  /** خواندن فایل باینری-امن از سرور (base64) */
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

  /** نوشتن فایل روی سرور با base64 چانک‌شده (هر چانک ≤ ۲۴K کاراکتر — سقف بستهٔ SSH) */
  async writeFile(path: string, content: Buffer | string, timeoutMs = 30_000): Promise<void> {
    const b64 = Buffer.from(content).toString("base64");
    // حداکثر اندازهٔ چانک: رشتهٔ فرمان باید در «یک بستهٔ انتقال SSH» (~۳۲KB) جا شود —
    // ۴۸K کاراکتر عملاً «Unable to exec» می‌داد و اتصال را می‌کشت (باگ واقعی، این جلسه اصلاح شد).
    const CHUNK = 24_000; // کاراکترهای base64 (≈ ۱۸KB دیتای خام در هر چانک)
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
    // فایل خالی
    if (b64.length === 0) {
      const res = await this.exec(`: > ${q}`, { timeoutMs });
      if (res.code !== 0) {
        throw new HemError("EXEC_FAILED", "نوشتن فایل خالی روی سرور ناموفق بود.", { path });
      }
    }
  }

  /** نام فایل موقت منحصربه‌فرد روی سرور (در /tmp) — پسوند لازم است چون headscale/viper نوع فایل را از پسوند می‌خواند */
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
    // اطمینان نهایی
    setTimeout(() => {
      try {
        this.client.destroy();
      } catch {
        /* ignore */
      }
    }, 2_000).unref?.();
  }
}
