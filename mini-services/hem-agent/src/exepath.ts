// exepath — runtime environment detection and "the folder next to the program" — shared unit for index.ts and config.ts.
//
// v0.3.1 bug (Windows): the bun bundle virtual-filesystem marker in the compiled binary
// is "$bunfs" with the absolute "/" prefix only on POSIX:
//   Linux:   /$bunfs/root/…
// The old startsWith("/$bunfs") check was false on Windows ← exeDir pointed into the
// virtual fs ← ui/ was not found ← GET / returned an ambiguous health JSON instead of the UI.
// Fix: membership ("contains $bunfs") instead of the POSIX absolute prefix.
//
// v0.3.2-beta.4 bug (real Windows — proven by the windows-latest CI runner, bun 1.4.x):
// on Windows the standalone exe does NOT use "$bunfs" at all. The bundle is mounted
// on a virtual drive whose root folder is "~BUN" (the drive letter varies — commonly B:):
//   Windows: B:\~BUN\root\…   ← contains neither "/" nor "$bunfs"
// "$bunfs" membership alone was still false on real Windows ← the very same v0.3.1
// failure came back ("ui: MISSING", 503 error page). Fix: also detect the "~BUN"
// virtual-drive root ("$bunfs" is kept for POSIX and older bun builds).

import * as path from "node:path";

/** Marker of the bun bundle virtual fs in the compiled binary — a constant bun string (POSIX / older builds) */
const BUNFS_MARKER = "$bunfs";

/**
 * Windows standalone executables mount the bundle on a virtual drive:
 *   B:\~BUN\root\…
 * "~BUN" sits directly under the drive root (any drive letter, optional for
 * a leading drive-less form). A plain folder merely NAMED "~BUN" deeper inside
 * a real tree is NOT the virtual root — the anchor must be the path root.
 */
const WIN_VIRTUAL_DRIVE_RE = /^(?:[A-Za-z]:)?[\\/]~BUN(?:[\\/]|$)/;

/**
 * true when the current source path is inside the bun virtual filesystem — i.e. we are
 * running from the compiled binary (Windows exe / Linux binary).
 * Pure and testable: takes the path, does not read the real environment.
 */
export function inCompiledBinary(importMetaDir: string): boolean {
  if (importMetaDir.includes(BUNFS_MARKER)) return true;
  return WIN_VIRTUAL_DRIVE_RE.test(importMetaDir);
}

/**
 * "The folder next to the program executable" — where the official package's ui/ and installer/ live:
 *   • Compiled binary: dirname(process.execPath) — the executable file's "real" path;
 *     in a compiled binary import.meta.dir points into the bun virtual fs and ui/ is
 *     never there (ui/ is packaged next to the exe, not inside it).
 *   • Dev mode with bun: the source folder (index.ts) — process.execPath is bun itself
 *     and nothing of this program lives next to it.
 *
 * dirname must match the execPath's path style (Windows: backslash/drive letter;
 * POSIX: slash) — detection is derived from the string itself, so tests can simulate
 * any host and real execution matches the platform's default path module.
 */
export function programDir(importMetaDir: string, execPath: string = process.execPath): string {
  if (!inCompiledBinary(importMetaDir)) return importMetaDir;
  const dirname = execPath.includes("\\") ? path.win32.dirname : path.dirname;
  return dirname(execPath);
}
