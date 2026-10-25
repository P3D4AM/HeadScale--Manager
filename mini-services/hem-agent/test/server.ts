// Test SSH server (REAL ssh2) on 127.0.0.1:2222 — for tests and the sandbox demo only.
//  - hostkey: RSA PKCS#1 PEM generated at runtime (node:crypto style; NOT an openssh string)
//  - auth: password "hemtest-pass" or the fixture ed25519 public key
//  - exec: runs LOCALLY via /bin/bash -c with the shim on PATH
//    (test/shim/headscale → /tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml)
//
// Standalone mode: `bun run test/server.ts` — the server stays up (sandbox demo).

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

/** Generate the RSA host key — PKCS#1 PEM (the pattern proven to work with ssh2 under Bun) */
export function generateHostKeyPem(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return String(privateKey);
}

/** Create/update the shim — the real headscale v0.29.5 with the test-server config */
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
  // noShim: a "clean" server — like a fresh VPS where headscale is not on PATH
  // (for testing the install flow; having headscale as a shim routes the installer to "manage existing install")
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
          /* an abrupt client disconnect must not kill the test server */
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
            // real stdin: client-written data goes to the child and EOF is forwarded too
            // (without this, `sudo -S` waiting on stdin would hang forever)
            stream.on("data", (d: Buffer) => {
              try {
                child.stdin.write(d);
              } catch {
                /* the child may already be gone */
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
                /* the child may already be gone */
              }
            });
            child.stdout.on("data", (d) => {
              if (!channelClosed) stream.write(d);
            });
            child.stderr.on("data", (d) => {
              if (!channelClosed) stream.stderr.write(d);
            });
            // child "close" = exit + fully flushed stdio — output ordering is guaranteed
            child.on("close", (code) => {
              if (!channelClosed) {
                try {
                  stream.exit(code ?? 0);
                  stream.close();
                } catch {
                  /* the channel may already be closed */
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
            // close every client (parked ones may block server close)
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
// Standalone mode: `bun run test/server.ts`
// ---------------------------------------------------------------------------
/** Persistent host-key path for the sandbox demo — generated once, reused.
 *  Without this, every demo-server restart would mint a fresh key and the user's
 *  saved profile would be rejected with HOSTKEY_CHANGED (Task 5-d). Tests use ephemeral keys. */
export const DEMO_HOSTKEY_PATH = join(FIXTURES_DIR, "hostkey.pem");

function loadOrCreateDemoHostKey(): string {
  try {
    const pem = readFileSync(DEMO_HOSTKEY_PATH, "utf8");
    if (pem.includes("PRIVATE KEY")) return pem;
  } catch {
    /* not created yet — generate it */
  }
  const pem = generateHostKeyPem();
  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(DEMO_HOSTKEY_PATH, pem, { mode: 0o600 });
  return pem;
}

if (import.meta.main) {
  const pem = loadOrCreateDemoHostKey();
  // Default demo flavor: "fresh VPS" — headscale not on PATH so the install flow
  // (17-step fresh install + dry-run with exit code 0) can be demonstrated; managing
  // headscale works via the profile's hsCustomPrefix (custom mode).
  // For a "managed server" demo (headscale on PATH): DEMO_WITH_SHIM=1
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
    /* keep the process alive */
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
