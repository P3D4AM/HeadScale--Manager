// Regression tests for the v0.3.1 Windows bug (UI not served from the EXE):
//
// On a Windows-compiled binary the bun bundle marker is "C:\$bunfs\root" —
// with a drive letter and backslashes. The old startsWith("/$bunfs") check only
// knew POSIX ← exeDir pointed at the virtual fs ← ui/ was never found ← GET /
// returned the ambiguous JSON {"ok":true,"service":"hem-agent",...} instead of
// the UI.
//
// These tests are pure (a synthetic path is injected) and deterministic on any
// host — i.e. they simulate and lock the Windows scenario without Windows.

import { describe, expect, test } from "bun:test";
import { inCompiledBinary, programDir } from "../src/exepath";
import { installerRootCandidates } from "../src/config";

describe("inCompiledBinary — the $bunfs marker on both platforms", () => {
  test("Linux: /$bunfs/root/… ← true", () => {
    expect(inCompiledBinary("/$bunfs/root/mini-services/hem-agent")).toBe(true);
  });

  test("Windows (v0.3.1 bug): C:\\$bunfs\\root\\… ← true — was rejected by startsWith(\"/$bunfs\")", () => {
    expect(inCompiledBinary("C:\\$bunfs\\root\\mini-services\\hem-agent")).toBe(true);
  });

  test("Windows without a drive letter: \\$bunfs\\root\\… ← true", () => {
    expect(inCompiledBinary("\\$bunfs\\root\\agent")).toBe(true);
  });

  test("dev mode (POSIX): a regular path ← false", () => {
    expect(inCompiledBinary("/home/z/proj/mini-services/hem-agent")).toBe(false);
  });

  test("dev mode (Windows-style): a regular path ← false", () => {
    expect(inCompiledBinary("C:\\dev\\HeadScale--Manager\\mini-services\\hem-agent")).toBe(false);
  });

  test("empty string ← false (no error)", () => {
    expect(inCompiledBinary("")).toBe(false);
  });
});

describe("programDir — the folder next to the executable", () => {
  test("Linux compiled binary: dirname(execPath) — where ui/ is packaged", () => {
    expect(programDir("/$bunfs/root/mini-services/hem-agent", "/opt/hem/hem-manager")).toBe("/opt/hem");
  });

  test("Windows compiled binary (v0.3.1 bug): dirname(execPath) with Windows path style", () => {
    // with the old logic: output = C:\$bunfs\root\mini-services\hem-agent (virtual fs — no ui/)
    expect(programDir("C:\\$bunfs\\root\\mini-services\\hem-agent", "C:\\Apps\\HeadscaleEasyManager\\hem-manager.exe")).toBe(
      "C:\\Apps\\HeadscaleEasyManager",
    );
  });

  test("Windows compiled binary — a path with spaces and parens (a real LOCALAPPDATA)", () => {
    expect(
      programDir(
        "C:\\$bunfs\\root\\agent",
        "C:\\Users\\Ali Karimi\\AppData\\Local\\HeadscaleEasyManager\\hem-manager.exe",
      ),
    ).toBe("C:\\Users\\Ali Karimi\\AppData\\Local\\HeadscaleEasyManager");
  });

  test("POSIX dev mode: the source folder itself (execPath is bun itself — meaningless)", () => {
    expect(programDir("/home/z/proj/mini-services/hem-agent", "/home/z/.bun/bin/bun")).toBe(
      "/home/z/proj/mini-services/hem-agent",
    );
  });

  test("Windows dev mode: the source folder itself", () => {
    expect(programDir("C:\\dev\\agent", "C:\\bun\\bun.exe")).toBe("C:\\dev\\agent");
  });
});

describe("config.installerRootCandidates — the dev candidate is dropped in a Windows binary", () => {
  test("a Windows $bunfs srcDir ← only env/packaged; no dev (v0.3.1 bug: a meaningless dev was added)", () => {
    const cands = installerRootCandidates(undefined, "C:\\Apps\\HeadscaleEasyManager", "C:\\$bunfs\\root\\agent");
    const sources = cands.map((c) => c.source);
    expect(sources).not.toContain("dev");
    expect(sources).toContain("packaged");
    // the packaged path = <exeDir>/installer (the separator style is left to the platform's path —
    // in a real Windows run path is win32 itself)
    const pkg = cands.find((c) => c.source === "packaged")?.path ?? "";
    expect(pkg.startsWith("C:\\Apps\\HeadscaleEasyManager")).toBe(true);
    expect(pkg.endsWith("installer")).toBe(true);
  });

  test("a POSIX $bunfs srcDir ← as before: no dev (preserved behavior)", () => {
    const cands = installerRootCandidates(undefined, "/opt/fake-exe", "/$bunfs/root/mini-services/hem-agent/src");
    expect(cands.map((c) => c.source)).not.toContain("dev");
  });

  test("a regular dev srcDir ← the dev candidate exists (preserved behavior)", () => {
    const cands = installerRootCandidates(undefined, "/opt/fake-exe", "/home/z/proj/mini-services/hem-agent/src");
    expect(cands.map((c) => c.source)).toContain("dev");
  });
});
