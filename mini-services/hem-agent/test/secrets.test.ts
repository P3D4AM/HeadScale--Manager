// تست مخزن اسرار + پاک‌سازی (redaction) + پروفایل‌ها
import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AuditLogger } from "../src/audit";
import { ProfileStore } from "../src/profiles";
import { Redactor } from "../src/redact";
import { SecretStore } from "../src/secrets";
import { tmpHome } from "./helpers";

test("secret store (فایل توسعه): رفت‌وبرگشت با persist و فقط-حافظه", () => {
  const home = tmpHome("hem-secrets-");
  const store = new SecretStore(home);
  expect(store.backend).toBe("file");

  // پیش‌فرض: فقط حافظه
  store.set("profile:p1", "MemoryOnly456");
  expect(store.get("profile:p1")).toBe("MemoryOnly456");

  // بازخوانی از فایل — نباید راز فقط-حافظه را ببیند
  const store2 = new SecretStore(home);
  expect(store2.get("profile:p1")).toBeUndefined();

  // با persist → ذخیرهٔ واقعی
  store.set("profile:p1", "SuperSecret123", { persist: true });
  const store3 = new SecretStore(home);
  expect(store3.get("profile:p1")).toBe("SuperSecret123");

  // حذف
  store3.delete("profile:p1");
  expect(new SecretStore(home).get("profile:p1")).toBeUndefined();

  // مجوز فایل 0600
  const st = statSync(join(home, "secrets.json"));
  expect(st.mode & 0o777).toBe(0o600);
});

test("redaction: audit هیچ‌گاه رمز/کلید کامل نمی‌نویسد", () => {
  const home = tmpHome("hem-audit-");
  const redactor = new Redactor();
  const audit = new AuditLogger(home, redactor);

  redactor.registerSecret("SuperSecret123");

  audit.log({
    action: "connect",
    target: "user@host password=SuperSecret123 key=hskey-auth-abcdefghij1234567890-xyzWVUTSRQPONML",
    ok: false,
    error: "AUTH_FAILED — password: WrongPass99",
  });
  redactor.registerSecret("WrongPass99");

  const text = readFileSync(join(home, "audit.log"), "utf8");
  // رمزها هرگز کامل ظاهر نمی‌شوند
  expect(text).not.toContain("SuperSecret123");
  // hskey همیشه ماسک است
  expect(text).not.toMatch(/hskey-auth-[A-Za-z0-9_-]{10,}(?!-?\*)/);
  expect(text).toMatch(/hskey-auth-[A-Za-z0-9_-]{0,5}-\*\*\*/);
  // الگوی password=… ماسک شده
  expect(text).toMatch(/password\s*=\s*\*\*\*/);

  // یک راز ثبت‌شدهٔ دیرهنگام هم در رکوردهای بعدی پاک می‌شود
  audit.log({ action: "test2", target: "retry with SuperSecret123", ok: true });
  const text2 = readFileSync(join(home, "audit.log"), "utf8");
  expect(text2).not.toContain("SuperSecret123");
});

test("redaction: کلید خصوصی PEM کامل حذف می‌شود", () => {
  const redactor = new Redactor();
  const fake = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc123 never leak me\n-----END OPENSSH PRIVATE KEY-----";
  const out = redactor.redactText(`error while parsing ${fake}`);
  expect(out).not.toContain("abc123");
  expect(out).toContain("<PRIVATE-KEY-REDACTED>");
});

test("profiles.json: CRUD کامل بدون هیچ سر + مجوز 0600", () => {
  const home = tmpHome("hem-profiles-");
  const store = new ProfileStore(home);

  const p = store.create({
    name: "سرور اصلی",
    host: "203.0.113.10",
    username: "admin",
    authMethod: "password",
    hsMode: "system-sudo",
  });
  expect(p.id).toMatch(/^p-/);
  expect(p.port).toBe(22);

  const updated = store.update(p.id, { name: "سرور اصلی ۲", port: 2222 });
  expect(updated.name).toBe("سرور اصلی ۲");
  expect(updated.port).toBe(2222);

  expect(store.list()).toHaveLength(1);
  const raw = readFileSync(join(home, "profiles.json"), "utf8");
  // هیچ فیلد سری در پروفایل ذخیره نمی‌شود — فقط authMethod (enum) مجاز است
  const parsed = JSON.parse(raw) as { profiles: Record<string, unknown>[] };
  const allowedKeys = new Set([
    "id", "name", "host", "port", "username", "authMethod", "keyPath",
    "hsMode", "hsCustomPrefix", "healthUrl", "logPath", "configPath", "createdAt", "updatedAt",
  ]);
  for (const [k, v] of Object.entries(parsed.profiles[0])) {
    expect(allowedKeys.has(k)).toBe(true);
    expect(String(v)).not.toMatch(/^hskey-/);
  }

  // اعتبارسنجی: کلید بدون مسیر
  expect(() =>
    store.create({ name: "بدون کلید", host: "h", username: "u", authMethod: "key", hsMode: "system" }),
  ).toThrow();
  // اعتبارسنجی: custom بدون پیشوند
  expect(() =>
    store.create({ name: "بدون پیشوند", host: "h", username: "u", authMethod: "password", hsMode: "custom" }),
  ).toThrow();

  store.remove(p.id);
  expect(store.list()).toHaveLength(0);

  const st = statSync(join(home, "profiles.json"));
  expect(st.mode & 0o777).toBe(0o600);
});
