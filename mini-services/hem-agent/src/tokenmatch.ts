// Timing-safe token comparison (v0.3.1 §4) — for the X-HEM-Token header and hem_token cookie.
// Different lengths return false immediately (length disclosure is not a practical threat; the value is never printed).

import { timingSafeEqual } from "node:crypto";

/** Are two token strings equal in constant time? (different length → false) */
export function timingSafeTokenMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (provided.length === 0 || expected.length === 0) return false;
  if (provided.length !== expected.length) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return timingSafeEqual(a, b);
}
