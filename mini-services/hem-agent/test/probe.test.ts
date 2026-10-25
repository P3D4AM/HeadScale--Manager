// System probe tests against the SSH test server — real Debian sandbox data
import { afterAll, beforeAll, expect, test } from "bun:test";
import { startTestServer, TEST_HOST, TEST_PASSWORD, type TestServerHandle } from "./server";
import { buildTestStack, connectAndConfirm, ensureHeadscaleHealthy, listenApp, type ListeningServer, type TestStack } from "./helpers";
import type { ProbeResult } from "../src/types";

let ts: TestServerHandle;
let stack: TestStack;
let srv: ListeningServer;
let sid: string;
const srvPort = (): number => ts.port;

beforeAll(async () => {
  ensureHeadscaleHealthy();
  ts = await startTestServer({ port: 0 });
  stack = buildTestStack({ authMode: "open" }); // v0.3.2 §2: business-logic tests under the documented dev exception (no auth)
  srv = await listenApp(stack.app);
  sid = await connectAndConfirm(srv.baseUrl, {
    host: TEST_HOST,
    port: srvPort(),
    username: "z",
    authMethod: "password",
    password: TEST_PASSWORD,
    hsMode: "custom",
    hsCustomPrefix: "/tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml",
    configPath: "/home/z/hs-test/config.yaml",
  });
}, 30_000);

afterAll(async () => {
  stack.dispose();
  await srv.close();
  await ts.close();
});

test("probe on a real server: honest Debian data", async () => {
  const res = await fetch(`${srv.baseUrl}/api/s/${sid}/probe`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; data: ProbeResult };
  expect(body.ok).toBe(true);
  const p = body.data;

  // the real OS
  expect(p.os.id).toBe("debian");
  expect(p.os.versionId).toBe("13");
  expect(p.os.pretty).toContain("Debian");
  expect(p.os.arch).toBe("x86_64");
  expect(p.kernel).toMatch(/^\d+\.\d+/);

  // systemd is honestly absent (a container without systemd)
  expect(p.systemd.available).toBe(false);

  // sudo: the hemtest-pass password is not user z's real sudo password → none (honest)
  expect(p.sudo.mode).toBe("none");

  // headscale is found on PATH via the shim (not a real dpkg install)
  expect(p.existing.headscale.installed).toBe(true);
  expect(p.existing.headscale.version).toBe("0.29.5");

  // real resources
  expect(p.cpu.cores).toBeGreaterThanOrEqual(1);
  expect(p.mem.totalMb).toBeGreaterThan(0);
  expect(p.mem.availMb).toBeGreaterThanOrEqual(0);
  expect(p.disk.rootGb).toBeGreaterThan(0);

  // ports: correct shape
  expect(Array.isArray(p.ports)).toBe(true);
  for (const port of p.ports) {
    expect(["tcp", "udp"]).toContain(port.proto);
    expect(typeof port.local).toBe("string");
  }

  // the test-server config exists
  expect(p.headscaleConfigExists).toBe(true);

  // ufw honestly: not installed
  expect(p.firewall.ufw).toBe("not-installed");

  // warnings/blockers: Persian strings and arrays
  expect(Array.isArray(p.warnings)).toBe(true);
  expect(Array.isArray(p.blockers)).toBe(true);
  // this sandbox's disk is < 10G → honestly reported as a blocker
  if (p.disk.rootGb < 10) {
    expect(p.blockers.some((b) => b.includes("دیسک"))).toBe(true);
  }
  // sudo is also none → the corresponding blocker
  expect(p.blockers.some((b) => b.includes("sudo"))).toBe(true);

  // network addresses
  expect(Array.isArray(p.net.addresses)).toBe(true);
  expect(p.net.addresses.length).toBeGreaterThan(0);
});
