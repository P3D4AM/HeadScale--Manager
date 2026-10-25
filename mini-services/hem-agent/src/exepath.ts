// exepath — runtime environment detection and "the folder next to the program" — shared unit for index.ts and config.ts.
//
// v0.3.1 bug (Windows): the bun bundle virtual-filesystem marker in the compiled binary
// is "$bunfs" on both platforms, but only POSIX has the absolute "/" prefix:
//   Linux:   /$bunfs/root/…
//   Windows: C:\$bunfs\root\…   (drive letter + backslash)
// The old startsWith("/$bunfs") check was false on Windows ← exeDir pointed into the
// virtual fs ← ui/ was not found ← GET / returned an ambiguous health JSON instead of the UI.
// Fix: membership ("contains $bunfs") instead of the POSIX absolute prefix.

import * as path from "node:path";

/** Marker of the bun bundle virtual fs in the compiled binary — a constant bun string on both platforms */
const BUNFS_MARKER = "$bunfs";

/**
 * true when the current source path is inside the bun virtual filesystem — i.e. we are
 * running from the compiled binary (Windows exe / Linux binary).
 * Pure and testable: takes the path, does not read the real environment.
 */
export function inCompiledBinary(importMetaDir: string): boolean {
  return importMetaDir.includes(BUNFS_MARKER);
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
