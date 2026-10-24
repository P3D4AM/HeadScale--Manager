// سرور SSH آزمایشی (REAL ssh2) روی 127.0.0.1:2222 — فقط برای تست‌ها و دموی sandbox.
//  - hostkey: RSA PKCS#1 PEM تولیدشده در زمان اجرا (الگوی node:crypto؛ NOT openssh string)
//  - احراز هویت: رمز «hemtest-pass» یا کلید عمومی ed25519 فیکسچر
//  - exec: اجرای LOCALLY از طریق /bin/bash -c با shim در PATH
//    (test/shim/headscale → /tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml)
//
// حالت مستقل: `bun run test/server.ts` — سرور بالا می‌ماند (دموی sandbox).

import { Server as SshServer, utils as sshUtils } from "ssh2";
import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TEST_PORT = 2222;
export const TEST_HOST = "127.0.0.1";
export const TEST_PASSWORD = "hemtest-pass";
export const FIXTURES_DIR = join(import.meta.dir, "fixtures");
export const SHIM_DIR = join(import.meta.dir, "shim");

/** تولید کلید میزبان RSA — PKCS#1 PEM (الگوی تأییدشدهٔ ssh2 زیر Bun) */
export function generateHostKeyPem(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return String(privateKey);
}

/** ساخت/به‌روزرسانی shim — headscale واقعی v0.29.5 با config سرور آزمایشی */
export function ensureShim(): string {
  mkdirSync(SHIM_DIR, { recursive: true });
  const shim = join(SHIM_DIR, "headscale");
  writeFileSync(shim, "#!/bin/bash\nexec /tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml \"$@\"\n");
  chmodSync(shim, 0o755);
  return SHIM_DIR;
}

function loadAuthorizedPubKeys(): Buffer[] {
  const keys: Buffer[] = [];
  for (const f of ["id_ed25519.pub", "id_ed25519_pass.pub"]) {
    const line = readFileSync(join(FIXTURES_DIR, f), "utf8").trim();
    const b64 = line.split(/\s+/)[1];
    keys.push(Buffer.from(b64, "base64"));
  }
  return keys;
}

export interface TestServerHandle {
  host: string;
  port: number;
  close: () => Promise<void>;
}

export async function startTestServer(
  opts: { port?: number; hostKeyPem?: string; noShim?: boolean } = {},
): Promise<TestServerHandle> {
  const port = opts.port ?? TEST_PORT;
  const hostKey = opts.hostKeyPem ?? generateHostKeyPem();
  const shimDir = ensureShim();
  // noShim: سرورِ «تمیز» — مثل یک VPS تازه که headscale روی PATH آن نیست
  // (برای تست جریان نصب؛ shim بودن headscale مسیر نصب‌کننده را به «مدیریت نصب موجود» می‌برد)
  const childPath = opts.noShim ? (process.env.PATH ?? "/usr/bin:/bin") : `${shimDir}:${process.env.PATH ?? "/usr/bin:/bin"}`;
  const authorizedKeys = loadAuthorizedPubKeys();

  return new Promise<TestServerHandle>((resolve, reject) => {
    const clients = new Set<{ end: () => void; destroy?: () => void }>();
    const server = new SshServer(
      { hostKeys: [hostKey] },
      (client) => {
        clients.add(client as unknown as { end: () => void });
        client.on("close", () => clients.delete(client as unknown as { end: () => void }));
        client.on("authentication", (ctx) => {
          if (ctx.method === "password" && ctx.password === TEST_PASSWORD) {
            ctx.accept();
            return;
          }
          if (ctx.method === "publickey" && ctx.key && ctx.key.data) {
            const keyOk =
              ctx.key.algo === "ssh-ed25519" &&
              authorizedKeys.some((k) => ctx.key!.data.equals(k));
            if (!keyOk) {
              ctx.reject(["password", "publickey"]);
              return;
            }
            if (ctx.signature && ctx.blob) {
              try {
                const parsed = sshUtils.parseKey(`${ctx.key.algo} ${ctx.key.data.toString("base64")}`);
                if (!parsed || parsed instanceof Error || !parsed.verify(ctx.blob, ctx.signature)) {
                  ctx.reject(["publickey"]);
                  return;
                }
              } catch {
                ctx.reject(["publickey"]);
                return;
              }
            }
            ctx.accept();
            return;
          }
          ctx.reject(["password", "publickey"]);
        });
        client.on("error", () => {
          /* قطع ناگهانی کلاینت نباید سرور تست را بکشد */
        });
        client.on("session", (accept) => {
          const session = accept();
          session.on("exec", (acceptExec, _reject, info) => {
            const stream = acceptExec();
            const child = spawn("/bin/bash", ["-c", info.command], {
              cwd: process.env.HOME ?? "/home/z",
              env: {
                ...process.env,
                PATH: childPath,
              },
            });
            let channelClosed = false;
            // stdin واقعی: دیتای نوشته‌شدهٔ کلاینت به فرزند می‌رود و EOF هم منتقل می‌شود
            // (بدون این، `sudo -S` که منتظر stdin است تا ابد می‌ماند)
            stream.on("data", (d: Buffer) => {
              try {
                child.stdin.write(d);
              } catch {
                /* فرزند ممکن است تمام شده باشد */
              }
            });
            stream.on("end", () => {
              try {
                child.stdin.end();
              } catch {
                /* ignore */
              }
            });
            stream.on("close", () => {
              channelClosed = true;
              try {
                child.stdin.end();
              } catch {
                /* ignore */
              }
              try {
                child.kill("SIGKILL");
              } catch {
                /* فرزند ممکن است تمام شده باشد */
              }
            });
            child.stdout.on("data", (d) => {
              if (!channelClosed) stream.write(d);
            });
            child.stderr.on("data", (d) => {
              if (!channelClosed) stream.stderr.write(d);
            });
            // «close» فرزند = خروج + تخلیهٔ کامل stdio — ترتیب خروجی تضمین می‌شود
            child.on("close", (code) => {
              if (!channelClosed) {
                try {
                  stream.exit(code ?? 0);
                  stream.close();
                } catch {
                  /* کانال ممکن است بسته باشد */
                }
              }
            });
            child.on("error", () => {
              try {
                stream.exit(127);
                stream.close();
              } catch {
                /* ignore */
              }
            });
          });
        });
      },
    );
    server.on("error", (e: Error) => {
      reject(e);
    });
    server.listen(port, TEST_HOST, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        host: TEST_HOST,
        port: actualPort,
        close: () =>
          new Promise<void>((res) => {
            // بستن همهٔ کلاینت‌ها (پارک‌شده‌ها ممکن است مانع close شوند)
            for (const c of [...clients]) {
              try {
                c.end();
              } catch {
                /* ignore */
              }
            }
            setTimeout(() => {
              for (const c of [...clients]) {
                try {
                  c.destroy?.();
                } catch {
                  /* ignore */
                }
              }
            }, 400).unref?.();
            let done = false;
            const finish = () => {
              if (!done) {
                done = true;
                res();
              }
            };
            server.close(() => finish());
            setTimeout(finish, 1_500).unref?.();
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// حالت مستقل: `bun run test/server.ts`
// ---------------------------------------------------------------------------
/** مسیر کلید میزبان ماندگار دموی sandbox — تولید یک‌بار، استفادهٔ مکرر.
 *  بدون این، هر ری‌استارت سرورِ دمو کلید تازه‌ای می‌ساخت و پروفایل ذخیره‌شدهٔ
 *  کاربر با HOSTKEY_CHANGED رد می‌شد (Task 5-d). تست‌ها کلید لحظه‌ای می‌سازند. */
export const DEMO_HOSTKEY_PATH = join(FIXTURES_DIR, "hostkey.pem");

function loadOrCreateDemoHostKey(): string {
  try {
    const pem = readFileSync(DEMO_HOSTKEY_PATH, "utf8");
    if (pem.includes("PRIVATE KEY")) return pem;
  } catch {
    /* هنوز ساخته نشده — تولید می‌کنیم */
  }
  const pem = generateHostKeyPem();
  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(DEMO_HOSTKEY_PATH, pem, { mode: 0o600 });
  return pem;
}

if (import.meta.main) {
  const pem = loadOrCreateDemoHostKey();
  // حالت پیش‌فرض دمو: «VPS تازه» — headscale روی PATH نیست تا جریان نصب
  // (نصب تازهٔ ۱۷ گامی + dry-run با کد خروج ۰) قابل نمایش باشد؛ مدیریت
  // headscale از طریق hsCustomPrefix پروفایل (حالت custom) کار می‌کند.
  // برای دموی «سرور مدیریت‌شده» (headscale روی PATH): DEMO_WITH_SHIM=1
  const withShim = process.env.DEMO_WITH_SHIM === "1";
  const handle = await startTestServer({ port: TEST_PORT, hostKeyPem: pem, noShim: !withShim });
  console.log(`[test-server] SSH test server on ${handle.host}:${handle.port}`);
  console.log(`[test-server] password auth: any-user / ${TEST_PASSWORD}`);
  console.log(`[test-server] publickey: test/fixtures/id_ed25519`);
  console.log(
    withShim
      ? `[test-server] shim: ${SHIM_DIR}/headscale (managed-VPS flavor)`
      : `[test-server] PATH: clean (fresh-VPS flavor — install flow demo; set DEMO_WITH_SHIM=1 for shim)`,
  );
  const keepAlive = setInterval(() => {
    /* بالا نگه‌داشتن پروسه */
  }, 60_000);
  process.on("SIGINT", () => {
    clearInterval(keepAlive);
    void handle.close().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    clearInterval(keepAlive);
    void handle.close().then(() => process.exit(0));
  });
}
