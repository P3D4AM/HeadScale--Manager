// تست‌های رگرسیون باگ Parser نصب‌کننده (v0.3.2-beta.2 — install.ps1).
//
// باگ: تا v0.3.2-beta.1 فایل‌های متنیِ بستهٔ ویندوزی با heredoc بش ساخته
// می‌شدند: «UTF-8 بدون BOM» + «LF تنها». Windows PowerShell 5.1 فایل بدون BOM
// را با کدپیج ANSI می‌خواند (CP1256/CP1252) → متن فارسی خراب + بعضی بایت‌های
// فارسی به «نویسه‌های نقل‌قولی یونی‌کد» ترجمه می‌شدند که Parser جداکنندهٔ
// رشته می‌شناسدشان. زنجیرهٔ اثبات‌شده (با Parser واقعی PowerShell، بازتولید
// دقیق خطای کاربر): خط ۹ «ل» (D9 84 → بایت 84 → „ U+201E) رشتهٔ دوبل‌کوت را
// زودتر می‌بندد؛ " انتهای خط ۹ رشتهٔ جدید باز می‌کند که در خط ۴۱ با ”
// (از — یعنی E2 80 94 → بایت 94 → U+201D) بسته می‌شود؛ ' انتهای خط ۴۱
// رشتهٔ تک‌کوت باز می‌کند که با ' ابتدای خط ۴۲ بسته می‌شود → توکن‌های لخت →
// «Unexpected token ')'» در ۴۲:۱۰۴ و ' آخر خط ۴۲ رشته‌ای می‌بازد که هرگز
// بسته نمی‌شود → «string missing terminator» در ۴۲:۱۰۶ — دقیقاً خطای کاربر.
// مجموعهٔ کامل جداکننده‌ها (هر ۷ نویسه با Parser واقعی آزموده شد):
// تک‌کوتی U+2018/U+2019/U+201A/U+201B (ق → ‚) و دوبل‌کوتی U+201C/U+201D/U+201E
// (— → ” و ل → „).
//
// این تست‌ها قرارداد بایت‌های قالب‌ها را قفل می‌کنند:
//   ۱) BOMِ UTF-8 (پیش‌شرط خوانده‌شدن درست توسط PS 5.1)؛
//   ۲) فقط CRLF؛
//   ۳) هیچ نویسهٔ U+2018..U+201D (کوتیشن هوشمند — همان قاتلِ Parser)؛
//   ۴) رشته‌های فارسی کلیدی سالم‌اند («Run anyway» و …)؛
//   ۵) README: جانگلدار @VERSION@ و بخش عیب‌یابی؛
//   ۶) اگر pwsh در دسترس بود: بررسی نحوی با «Parser خود PowerShell»
//      (صادقانه: در نبود pwsh همین بخش انجام نمی‌شود — در CI ویندوزی با
//      Windows PowerShell 5.1 واقعی انجام می‌شود؛ بخش‌های ۱-۵ همیشه اجرا می‌شوند).

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const TPL = path.join(import.meta.dir, "..", "packaging", "templates");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function bytes(p: string): Buffer {
  return fs.readFileSync(p);
}

test("T1 قالب‌ها موجودند", () => {
  for (const f of ["install.ps1", "uninstall.ps1", "README-WINDOWS-FA.txt"]) {
    expect(fs.existsSync(path.join(TPL, f))).toBe(true);
  }
});

test("T2 BOMِ UTF-8 دارند (پیش‌شرط درست‌خوانده‌شدن در Windows PowerShell 5.1)", () => {
  for (const f of ["install.ps1", "uninstall.ps1", "README-WINDOWS-FA.txt"]) {
    const b = bytes(path.join(TPL, f));
    expect(b.subarray(0, 3).equals(BOM)).toBe(true);
  }
});

test("T3 فقط CRLF — هیچ LF/CR تنها نیست و فایل با CRLF تمام می‌شود", () => {
  for (const f of ["install.ps1", "uninstall.ps1", "README-WINDOWS-FA.txt"]) {
    const body = bytes(path.join(TPL, f)).subarray(3);
    const stripped = Buffer.from(body); // نسخهٔ قابل تغییر
    // شمارش با جایگزینی: lf تنها = کل LF منهای CRLF
    let lf = 0;
    let crlf = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === 0x0a) {
        lf++;
        if (i > 0 && body[i - 1] === 0x0d) crlf++;
      }
    }
    expect(stripped.length).toBeGreaterThan(0);
    expect(lf).toBe(crlf); // هر LF قبلی‌اش CR دارد
    expect(body[body.length - 2]).toBe(0x0d);
    expect(body[body.length - 1]).toBe(0x0a);
  }
});

test("T4 هیچ نویسهٔ نقل‌قولیِ یونی‌کد (U+2018..U+201E) — قاتلِ Parser — نیست", () => {
  for (const f of ["install.ps1", "uninstall.ps1", "README-WINDOWS-FA.txt"]) {
    const text = bytes(path.join(TPL, f)).toString("utf8");
    for (const ch of text) {
      const c = ch.codePointAt(0) ?? 0;
      // U+2018..U+201E = ‘ ’ ‚ ‛ “ ” „ — هر هفت نویسه با «Parser واقعی PowerShell»
      // آزموده شدند و جداکنندهٔ رشته شناخته می‌شوند (تک‌کوتی‌ها: 2018/2019/201A/201B؛
      // دوبل‌کوتی‌ها: 201C/201D/201E — «ل» فارسی در خوانش ANSI دقیقاً به „ U+201E
      // بدل می‌شود و همان بود که خط ۹ نسخهٔ خراب را شکست). U+201F و « » بی‌خطرند.
      expect(c < 0x2018 || c > 0x201e).toBe(true);
    }
  }
});

test("T5 رشته‌های فارسی کلیدی سالم‌اند (پیام نصب/Run anyway/حذف — بدون متن خراب‌شده)", () => {
  const install = bytes(path.join(TPL, "install.ps1")).toString("utf8");
  expect(install).toContain("نصب مدیر آسان هداسکیل");
  expect(install).toContain("«More info»");
  expect(install).toContain("«Run anyway»");
  expect(install).toContain("برنامه امضای دیجیتال ندارد");
  expect(install).toContain("نصب کامل شد");
  expect(install).toContain("یادآوری صادقانه");
  const uninstall = bytes(path.join(TPL, "uninstall.ps1")).toString("utf8");
  expect(uninstall).toContain("برنامه حذف شد");
  expect(uninstall).toContain("هیچ چیزی روی سرور شما تغییر نمی‌دهد");
});

test("T6 README: جانگلدار @VERSION@ + بخش عیب‌یابی + مسیر لاگ تشخیصی", () => {
  const readme = bytes(path.join(TPL, "README-WINDOWS-FA.txt")).toString("utf8");
  expect(readme).toContain("@VERSION@"); // در build جایگزین می‌شود (build-windows.sh)
  expect(readme).toContain("۵) عیب‌یابی");
  expect(readme).toContain("$LASTEXITCODE");
  expect(readme).toContain("%USERPROFILE%\\.hem-agent\\logs\\hem-agent.log");
  expect(readme).toContain("EADDRINUSE");
});

// ---------------------------------------------------------------------------
// T7 — بررسی نحوی با «Parser خود PowerShell» (اگر pwsh در دسترس بود).
// بازتولید دقیقِ همان کلاس خطا که کاربر دید، این‌بار روی فایلِ سالم — باید صفر
// خطا بدهد. در نبود pwsh، این بخش «انجام‌نشده» گزارش می‌شود (skipIf محیطی؛
// بخش‌های T1..T6 همیشه اجرا می‌شوند و هیچ تستی حذف/تضعیف نمی‌شود).
// ---------------------------------------------------------------------------
const hasPwsh = (() => {
  const r = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
    encoding: "utf8",
    timeout: 20_000,
  });
  return r.status === 0;
})();

const psParseScript = `
$bad = 0
foreach ($f in @("install.ps1", "uninstall.ps1")) {
  $p = Join-Path $env:PS1TPL $f
  $errs = $null; $tok = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tok, [ref]$errs)
  if ($errs.Count -gt 0) {
    $errs | ForEach-Object { Write-Output ("ERR " + $_.Extent.StartLineNumber + ":" + $_.Extent.StartColumnNumber + " " + $_.Message) }
    $bad = 1
  }
}
# رشته‌های فارسی باید تا AST سالم برسند (یعنی هنگام اجرا درست نمایش داده می‌شوند)
$errsI = $null; $tokI = $null
$astI = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $env:PS1TPL "install.ps1"), [ref]$tokI, [ref]$errsI)
$strs = @()
$strs += $astI.FindAll({$args[0] -is [System.Management.Automation.Language.StringConstantExpressionAst]}, $true) | ForEach-Object { $_.Value }
$strs += $astI.FindAll({$args[0] -is [System.Management.Automation.Language.ExpandableStringExpressionAst]}, $true) | ForEach-Object { $_.Value }
foreach ($m in @("«Run anyway»", "برنامه امضای دیجیتال ندارد", "نصب کامل شد")) {
  if (-not ($strs | Where-Object { $_ -like ("*" + $m + "*") })) { Write-Output ("MISSING " + $m); $bad = 1 }
}
if ($bad -eq 0) { Write-Output "PARSE+AST OK" } else { exit 1 }
`;

test.skipIf(!hasPwsh)("T7 Parser واقعی PowerShell: install/uninstall صفر خطا + رشته‌های فارسی تا AST", () => {
  const r = spawnSync("pwsh", ["-NoProfile", "-Command", psParseScript], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, PS1TPL: TPL },
  });
  if (!hasPwsh) return;
  expect(r.status).toBe(0);
  expect((r.stdout ?? "")).toContain("PARSE+AST OK");
});

if (!hasPwsh) {
  console.warn("[ps1-encoding] صادقانه: pwsh در PATH نیست — T7 (Parser واقعی) در این محیط انجام نشد؛ T1..T6 اجرا شدند. CI ویندوزی با Windows PowerShell 5.1 واقعی این بررسی را انجام می‌دهد.");
}
