// Installer Parser-bug regression tests (v0.3.2-beta.2 — install.ps1;
// v0.3.2-beta.3 — templates are English-only per user directive).
//
// Bug: until v0.3.2-beta.1 the Windows package text files were generated via
// a bash heredoc: "UTF-8 without BOM" + "LF only". Windows PowerShell 5.1
// reads a BOM-less file with the ANSI codepage (CP1256/CP1252) -> garbled
// Persian text, and some Persian bytes got translated into "Unicode quote
// characters" that the Parser recognizes as string delimiters. The proven
// chain (with PowerShell's real Parser, reproducing the user's exact error):
// line 9, the Persian letter lam (U+0644, D9 84 -> byte 84 -> „ U+201E) closed
// the double-quoted string
// early; the " at the end of line 9 opened a new string closed at line 41 by
// ” (from — i.e. E2 80 94 -> byte 94 -> U+201D); the ' at the end of line 41
// opened a single-quoted string closed by the ' at the start of line 42 ->
// naked tokens -> "Unexpected token ')'" at 42:104 and the trailing ' of
// line 42 opened a never-closed string -> "string missing terminator" at
// 42:106 — exactly the user's error. Full delimiter set (all 7 characters
// tested with the real Parser): single quotes U+2018/U+2019/U+201A/U+201B
// (U+0643 ghaf -> ‚) and double quotes U+201C/U+201D/U+201E (— -> ” and lam -> „).
//
// v0.3.2-beta.3: install.ps1/uninstall.ps1 are now pure-ASCII English — the
// whole risk class is eliminated — but the byte contract below stays locked:
//   1) UTF-8 BOM (precondition for correct reading by PS 5.1);
//   2) CRLF only;
//   3) no U+2018..U+201D characters (smart quotes — the Parser killer);
//   4) key English strings of the installer survive intact ("Run anyway" etc.);
//   5) README (Persian end-user guide, opened in Notepad — not terminal):
//      @VERSION@ placeholder + troubleshooting section;
//   6) if pwsh is available: syntax check with "PowerShell's own Parser"
//      (honest: without pwsh this part is skipped — Windows CI with real
//      Windows PowerShell 5.1 does it; parts 1-5 always run).
//   7) NEW: installer templates must contain NO Persian/Arabic-script
//      characters at all (user directive: terminal = English-only; this
//      also removes every mojibake/RTL rendering risk on Windows consoles).

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const TPL = path.join(import.meta.dir, "..", "packaging", "templates");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function bytes(p: string): Buffer {
  return fs.readFileSync(p);
}

test("T1 templates exist", () => {
  for (const f of ["install.ps1", "uninstall.ps1", "install-tailscale.ps1", "README-WINDOWS-FA.txt"]) {
    expect(fs.existsSync(path.join(TPL, f))).toBe(true);
  }
});

test("T2 have UTF-8 BOM (precondition for correct reading by Windows PowerShell 5.1)", () => {
  for (const f of ["install.ps1", "uninstall.ps1", "install-tailscale.ps1", "README-WINDOWS-FA.txt"]) {
    const b = bytes(path.join(TPL, f));
    expect(b.subarray(0, 3).equals(BOM)).toBe(true);
  }
});

test("T3 CRLF only — no lone LF/CR and the file ends with CRLF", () => {
  for (const f of ["install.ps1", "uninstall.ps1", "install-tailscale.ps1", "README-WINDOWS-FA.txt"]) {
    const body = bytes(path.join(TPL, f)).subarray(3);
    const stripped = Buffer.from(body); // mutable copy
    // counting by substitution: lone lf = total LF minus CRLF
    let lf = 0;
    let crlf = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === 0x0a) {
        lf++;
        if (i > 0 && body[i - 1] === 0x0d) crlf++;
      }
    }
    expect(stripped.length).toBeGreaterThan(0);
    expect(lf).toBe(crlf); // every LF has a CR before it
    expect(body[body.length - 2]).toBe(0x0d);
    expect(body[body.length - 1]).toBe(0x0a);
  }
});

test("T4 no Unicode quote characters (U+2018..U+201E) — the Parser killer", () => {
  for (const f of ["install.ps1", "uninstall.ps1", "install-tailscale.ps1", "README-WINDOWS-FA.txt"]) {
    const text = bytes(path.join(TPL, f)).toString("utf8");
    for (const ch of text) {
      const c = ch.codePointAt(0) ?? 0;
      // U+2018..U+201E = ‘ ’ ‚ ‛ “ ” „ — all seven characters were tested with
      // "PowerShell's real Parser" and are recognized as string delimiters
      // (single quotes: 2018/2019/201A/201B; double quotes: 201C/201D/201E —
      // Persian lam (U+0644) read as ANSI becomes exactly „ U+201E, which is what broke
      // line 9 of the corrupted version). U+201F and « » are harmless.
      expect(c < 0x2018 || c > 0x201e).toBe(true);
    }
  }
});

test("T5 key English installer strings intact (install/uninstall messages — no corrupted text)", () => {
  const install = bytes(path.join(TPL, "install.ps1")).toString("utf8");
  expect(install).toContain("Installing Headscale Easy Manager from:");
  expect(install).toContain('"More info"');
  expect(install).toContain('"Run anyway"');
  expect(install).toContain("the app has no digital signature");
  expect(install).toContain("Installation complete.");
  expect(install).toContain("Honest note");
  const uninstall = bytes(path.join(TPL, "uninstall.ps1")).toString("utf8");
  expect(uninstall).toContain("Uninstalled.");
  expect(uninstall).toContain("changes nothing on your server");
  // v0.3.2-beta.5: the OFFLINE Tailscale installer (bundled MSI) — key strings
  const ts = bytes(path.join(TPL, "install-tailscale.ps1")).toString("utf8");
  expect(ts).toContain("OFFLINE Tailscale installer");
  expect(ts).toContain("msiexec.exe");
  expect(ts).toContain("vendor\\tailscale");
  expect(ts).toContain("Get-Service Tailscale");
  expect(ts).toContain("-Interactive");
  expect(ts).toContain("login --login-server");
});

test("T5b installer scripts are English-only — zero Arabic-script characters (user directive v0.3.2-beta.3)", () => {
  // Terminal output must be English-only per the user's directive. This also
  // eliminates the entire mojibake/RTL-rendering risk class on Windows
  // consoles (the root cause of the original Parser bug).
  for (const f of ["install.ps1", "uninstall.ps1", "install-tailscale.ps1"]) {
    // subarray(3) skips the UTF-8 BOM (U+FEFF would false-positive in the
    // Arabic presentation-forms range below).
    const text = bytes(path.join(TPL, f)).subarray(3).toString("utf8");
    const arabic = [...text].filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return (c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff);
    });
    expect(arabic).toEqual([]);
    // Pure ASCII is the strongest guarantee for PowerShell 5.1 across all
    // system codepages — lock it in.
    for (const ch of text) {
      expect(ch.codePointAt(0) ?? 0).toBeLessThanOrEqual(0x7f);
    }
  }
});

test("T6 README: @VERSION@ placeholder + troubleshooting section + diagnostic log path + offline Tailscale section", () => {
  const readme = bytes(path.join(TPL, "README-WINDOWS-FA.txt")).toString("utf8");
  expect(readme).toContain("@VERSION@"); // replaced by build-windows.sh
  expect(readme).toContain("۵) عیب‌یابی");
  expect(readme).toContain("$LASTEXITCODE");
  expect(readme).toContain("%USERPROFILE%\\.hem-agent\\logs\\hem-agent.log");
  expect(readme).toContain("EADDRINUSE");
  // v0.3.2-beta.5: the offline Tailscale install section must be discoverable
  expect(readme).toContain("۶) نصب آفلاین Tailscale");
  expect(readme).toContain("install-tailscale.ps1");
  expect(readme).toContain("vendor\\tailscale");
});

// ---------------------------------------------------------------------------
// T7 — syntax check with "PowerShell's own Parser" (if pwsh is available).
// Reproduces the same error class the user saw, this time on the healthy
// file — it must report zero errors. Without pwsh, this part is reported as
// "not performed" (environmental skipIf; T1..T6 always run and no test is
// ever removed/weakened).
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
foreach ($f in @("install.ps1", "uninstall.ps1", "install-tailscale.ps1")) {
  $p = Join-Path $env:PS1TPL $f
  $errs = $null; $tok = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tok, [ref]$errs)
  if ($errs.Count -gt 0) {
    $errs | ForEach-Object { Write-Output ("ERR " + $_.Extent.StartLineNumber + ":" + $_.Extent.StartColumnNumber + " " + $_.Message) }
    $bad = 1
  }
}
# Key installer strings must survive into the AST (i.e. they display correctly at run time)
$errsI = $null; $tokI = $null
$astI = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $env:PS1TPL "install.ps1"), [ref]$tokI, [ref]$errsI)
$strs = @()
$strs += $astI.FindAll({$args[0] -is [System.Management.Automation.Language.StringConstantExpressionAst]}, $true) | ForEach-Object { $_.Value }
$strs += $astI.FindAll({$args[0] -is [System.Management.Automation.Language.ExpandableStringExpressionAst]}, $true) | ForEach-Object { $_.Value }
foreach ($m in @('"Run anyway"', 'the app has no digital signature', 'Installation complete.')) {
  if (-not ($strs | Where-Object { $_ -like ("*" + $m + "*") })) { Write-Output ("MISSING " + $m); $bad = 1 }
}
if ($bad -eq 0) { Write-Output "PARSE+AST OK" } else { exit 1 }
`;

test.skipIf(!hasPwsh)("T7 real PowerShell Parser: install/uninstall zero errors + key strings reach the AST", () => {
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
  console.warn("[ps1-encoding] honest note: pwsh is not on PATH — T7 (real Parser) was not performed in this environment; T1..T6 ran. Windows CI with real Windows PowerShell 5.1 performs this check.");
}
