// Redaction utilities — no password/full key is ever written to logs/audit.
// Generic patterns + explicitly registered secrets (password, passphrase, private key content).

const PRIVATE_KEY_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

// hskey-auth-XXXXXXXXXXXXXXXXXXXXXX-YYYY…  →  hskey-auth-XXXXX-***
const HSKEY_RE = /\bhskey-(auth|api)-([A-Za-z0-9_-]{0,5})[A-Za-z0-9_-]*-?[A-Za-z0-9_-]*\b/g;

// Already-masked form (hskey-auth-XXX-***) — keeps redaction idempotent
const HSKEY_MASKED_RE = /\bhskey-(auth|api)-[A-Za-z0-9_-]{0,5}-\*\*\*/g;
const MASK_PLACEHOLDER = "\u0000HEM-MASKED-";

// password=… / passphrase: … / token: … → the value gets masked
const SECRET_ASSIGN_RE =
  /\b(password|passphrase|secret|token|api[_-]?key)\s*([:=])\s*\S+/gi;

/** Length threshold for accepting a string as a secret (very short strings are not masked) */
const MIN_SECRET_LEN = 6;

export function maskHsKey(fullKey: string): string {
  const m = /^hskey-(auth|api)-([A-Za-z0-9_-]{0,5})/.exec(fullKey);
  if (!m) return "***";
  return `hskey-${m[1]}-${m[2]}-***`;
}

export class Redactor {
  private secrets = new Set<string>();

  /** Register an explicit secret (password, passphrase, private key, full key) for masking in logs */
  registerSecret(value?: string | null): void {
    if (typeof value !== "string") return;
    const v = value.trim();
    if (v.length < MIN_SECRET_LEN) return;
    this.secrets.add(v);
  }

  /** Redact a text string */
  redactText(input: string): string {
    let out = input.replace(PRIVATE_KEY_RE, "<PRIVATE-KEY-REDACTED>");
    // 1) already-masked forms are set aside so they are not masked again (clean, stable output)
    const masked: string[] = [];
    out = out.replace(HSKEY_MASKED_RE, (m) => {
      masked.push(m);
      return `${MASK_PLACEHOLDER}${masked.length - 1}\u0000`;
    });
    out = out.replace(HSKEY_RE, (_m, kind: string, head: string) => `hskey-${kind}-${head}-***`);
    out = out.replace(new RegExp(`${MASK_PLACEHOLDER}(\\d+)\u0000`, "g"), (_m, i: string) => masked[Number(i)] ?? "");
    out = out.replace(SECRET_ASSIGN_RE, "$1$2***");
    for (const sec of this.secrets) {
      if (out.includes(sec)) out = out.split(sec).join("••••");
    }
    return out;
  }

  /** Deep-redact a value (object/array/string) — structure unchanged */
  redactValue<T>(value: T): T {
    if (typeof value === "string") return this.redactText(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v)) as unknown as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.redactValue(v);
      }
      return out as unknown as T;
    }
    return value;
  }
}

/** Quick redaction without registering secrets (for harmless strings covered by generic patterns) */
export function redactString(s: string): string {
  return new Redactor().redactText(s);
}
