// تست‌های regression باگ ویندوزی v0.3.1 (سرو نشدن UI از EXE):
//
// نشانگر باندل bun در باینری کامپایل‌شده روی ویندوز «C:\$bunfs\root» است —
// با حرف درایو و بک‌اسلش. بررسی قدیمی startsWith("/$bunfs") فقط پوزیکس را
// می‌شناخت ← exeDir به fs مجازی اشاره می‌کرد ← ui/ پیدا نمی‌شد ← GET / به‌جای
// رابط کاربری، JSON مبهم {"ok":true,"service":"hem-agent",...} می‌داد.
//
// این تست‌ها خالص‌اند (مسیر ساختگی تزریق می‌شود) و روی هر میزبانی قطعی‌اند —
// یعنی سناریوی ویندوزی را بدون ویندوز هم شبیه‌سازی و قفل می‌کنند.

import { describe, expect, test } from "bun:test";
import { inCompiledBinary, programDir } from "../src/exepath";
import { installerRootCandidates } from "../src/config";

describe("inCompiledBinary — نشانگر $bunfs در هر دو پلتفرم", () => {
  test("لینوکس: /$bunfs/root/… ← true", () => {
    expect(inCompiledBinary("/$bunfs/root/mini-services/hem-agent")).toBe(true);
  });

  test("ویندوز (باگ v0.3.1): C:\\$bunfs\\root\\… ← true — با startsWith(\"/$bunfs\") رد می‌شد", () => {
    expect(inCompiledBinary("C:\\$bunfs\\root\\mini-services\\hem-agent")).toBe(true);
  });

  test("ویندوز بدون حرف درایو: \\$bunfs\\root\\… ← true", () => {
    expect(inCompiledBinary("\\$bunfs\\root\\agent")).toBe(true);
  });

  test("حالت توسعه (پوزیکس): مسیر عادی ← false", () => {
    expect(inCompiledBinary("/home/z/proj/mini-services/hem-agent")).toBe(false);
  });

  test("حالت توسعه (ویندوزی): مسیر عادی ← false", () => {
    expect(inCompiledBinary("C:\\dev\\HeadScale--Manager\\mini-services\\hem-agent")).toBe(false);
  });

  test("رشتهٔ خالی ← false (بدون خطا)", () => {
    expect(inCompiledBinary("")).toBe(false);
  });
});

describe("programDir — پوشهٔ کنار فایل اجرایی", () => {
  test("باینری کامپایل‌شدهٔ لینوکسی: dirname(execPath) — جایی که ui/ بسته‌بندی می‌شود", () => {
    expect(programDir("/$bunfs/root/mini-services/hem-agent", "/opt/hem/hem-manager")).toBe("/opt/hem");
  });

  test("باینری کامپایل‌شدهٔ ویندوزی (باگ v0.3.1): dirname(execPath) با سبک مسیر ویندوز", () => {
    // با منطق قدیمی: خروجی = C:\$bunfs\root\mini-services\hem-agent (fs مجازی — ui/ نیست)
    expect(programDir("C:\\$bunfs\\root\\mini-services\\hem-agent", "C:\\Apps\\HeadscaleEasyManager\\hem-manager.exe")).toBe(
      "C:\\Apps\\HeadscaleEasyManager",
    );
  });

  test("باینری کامپایل‌شدهٔ ویندوزی — مسیر با فاصله و پرانتز (LOCALAPPDATA واقعی)", () => {
    expect(
      programDir(
        "C:\\$bunfs\\root\\agent",
        "C:\\Users\\Ali Karimi\\AppData\\Local\\HeadscaleEasyManager\\hem-manager.exe",
      ),
    ).toBe("C:\\Users\\Ali Karimi\\AppData\\Local\\HeadscaleEasyManager");
  });

  test("حالت توسعهٔ پوزیکس: همان پوشهٔ سورس (execPath خودِ bun است — بی‌معنا)", () => {
    expect(programDir("/home/z/proj/mini-services/hem-agent", "/home/z/.bun/bin/bun")).toBe(
      "/home/z/proj/mini-services/hem-agent",
    );
  });

  test("حالت توسعهٔ ویندوزی: همان پوشهٔ سورس", () => {
    expect(programDir("C:\\dev\\agent", "C:\\bun\\bun.exe")).toBe("C:\\dev\\agent");
  });
});

describe("config.installerRootCandidates — کاندید dev در باینری ویندوزی حذف می‌شود", () => {
  test("srcDir ویندوزیِ $bunfs ← فقط env/packaged؛ dev نیست (باگ v0.3.1: dev بی‌معنا اضافه می‌شد)", () => {
    const cands = installerRootCandidates(undefined, "C:\\Apps\\HeadscaleEasyManager", "C:\\$bunfs\\root\\agent");
    const sources = cands.map((c) => c.source);
    expect(sources).not.toContain("dev");
    expect(sources).toContain("packaged");
    // مسیر packaged = <exeDir>/installer (سبک جداکننده به path پلتفرم واگذار است —
    // در اجرای واقعی ویندوز path خودش win32 است)
    const pkg = cands.find((c) => c.source === "packaged")?.path ?? "";
    expect(pkg.startsWith("C:\\Apps\\HeadscaleEasyManager")).toBe(true);
    expect(pkg.endsWith("installer")).toBe(true);
  });

  test("srcDir پوزیکسِ $bunfs ← مثل قبل: dev نیست (رفتار حفظ‌شده)", () => {
    const cands = installerRootCandidates(undefined, "/opt/fake-exe", "/$bunfs/root/mini-services/hem-agent/src");
    expect(cands.map((c) => c.source)).not.toContain("dev");
  });

  test("srcDir عادی توسعه ← کاندید dev موجود است (رفتار حفظ‌شده)", () => {
    const cands = installerRootCandidates(undefined, "/opt/fake-exe", "/home/z/proj/mini-services/hem-agent/src");
    expect(cands.map((c) => c.source)).toContain("dev");
  });
});
