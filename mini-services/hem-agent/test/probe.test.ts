// تست کاوش سیستم (probe) روی سرور SSH آزمایشی — دادهٔ واقعی Debian sandbox
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
  stack = buildTestStack({ authMode: "open" }); // v0.3.2 §2: تست منطق کسب‌وکار در استثنای مستندِ توسعه (بدون احراز هویت)
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

test("probe روی سرور واقعی: دادهٔ صادقانهٔ Debian", async () => {
  const res = await fetch(`${srv.baseUrl}/api/s/${sid}/probe`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; data: ProbeResult };
  expect(body.ok).toBe(true);
  const p = body.data;

  // سیستم‌عامل واقعی
  expect(p.os.id).toBe("debian");
  expect(p.os.versionId).toBe("13");
  expect(p.os.pretty).toContain("Debian");
  expect(p.os.arch).toBe("x86_64");
  expect(p.kernel).toMatch(/^\d+\.\d+/);

  // systemd صادقانه غایب است (کانتینر بدون systemd)
  expect(p.systemd.available).toBe(false);

  // sudo: رمز hemtest-pass رمز واقعی sudo کاربر z نیست → none (صادقانه)
  expect(p.sudo.mode).toBe("none");

  // headscale از طریق shim در PATH پیدا می‌شود (نصب واقعی dpkg نیست)
  expect(p.existing.headscale.installed).toBe(true);
  expect(p.existing.headscale.version).toBe("0.29.5");

  // منابع واقعی
  expect(p.cpu.cores).toBeGreaterThanOrEqual(1);
  expect(p.mem.totalMb).toBeGreaterThan(0);
  expect(p.mem.availMb).toBeGreaterThanOrEqual(0);
  expect(p.disk.rootGb).toBeGreaterThan(0);

  // پورت‌ها: قالب درست
  expect(Array.isArray(p.ports)).toBe(true);
  for (const port of p.ports) {
    expect(["tcp", "udp"]).toContain(port.proto);
    expect(typeof port.local).toBe("string");
  }

  // پیکربندی سرور آزمایشی موجود است
  expect(p.headscaleConfigExists).toBe(true);

  // ufw صادقانه: نصب نیست
  expect(p.firewall.ufw).toBe("not-installed");

  // هشدارها/مانع‌ها: فارسی و آرایه
  expect(Array.isArray(p.warnings)).toBe(true);
  expect(Array.isArray(p.blockers)).toBe(true);
  // دیسک این sandbox < 10G است → صادقانه مانع گزارش شده
  if (p.disk.rootGb < 10) {
    expect(p.blockers.some((b) => b.includes("دیسک"))).toBe(true);
  }
  // sudo هم none است → مانع مربوطه
  expect(p.blockers.some((b) => b.includes("sudo"))).toBe(true);

  // آدرس‌های شبکه
  expect(Array.isArray(p.net.addresses)).toBe(true);
  expect(p.net.addresses.length).toBeGreaterThan(0);
});
