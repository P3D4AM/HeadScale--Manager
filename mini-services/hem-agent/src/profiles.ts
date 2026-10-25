// profiles.json + known_hosts.json in the agent home dir (0600) — no secrets are ever stored.

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { HemError } from "./errors";
import type { KnownHostEntry, Profile, ProfileInput } from "./types";

function ensureDir(home: string): void {
  fs.mkdirSync(home, { recursive: true });
  try {
    fs.chmodSync(home, 0o700);
  } catch {
    /* not possible on some filesystems */
  }
}

function writeJson0600(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best-effort */
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export class ProfileStore {
  private file: string;

  constructor(home: string) {
    ensureDir(home);
    this.file = path.join(home, "profiles.json");
    if (!fs.existsSync(this.file)) {
      writeJson0600(this.file, { profiles: [] });
    }
  }

  list(): Profile[] {
    return readJson<{ profiles: Profile[] }>(this.file, { profiles: [] }).profiles ?? [];
  }

  get(id: string): Profile | undefined {
    return this.list().find((p) => p.id === id);
  }

  create(input: ProfileInput): Profile {
    const now = new Date().toISOString();
    const profile: Profile = {
      id: `p-${randomBytes(4).toString("hex")}`,
      name: input.name,
      host: input.host,
      port: input.port ?? 22,
      username: input.username,
      authMethod: input.authMethod,
      keyPath: input.keyPath,
      hsMode: input.hsMode ?? "system-sudo",
      hsCustomPrefix: input.hsCustomPrefix,
      healthUrl: input.healthUrl,
      logPath: input.logPath,
      configPath: input.configPath,
      hsctlPath: input.hsctlPath,
      createdAt: now,
      updatedAt: now,
    };
    this.validate(profile);
    const all = this.list();
    all.push(profile);
    writeJson0600(this.file, { profiles: all });
    return profile;
  }

  update(id: string, patch: Partial<ProfileInput>): Profile {
    const all = this.list();
    const idx = all.findIndex((p) => p.id === id);
    if (idx < 0) throw new HemError("NOT_FOUND", "پروفایل یافت نشد.");
    const updated: Profile = {
      ...all[idx],
      ...patch,
      id: all[idx].id,
      createdAt: all[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    if (patch.port !== undefined) updated.port = patch.port ?? 22;
    this.validate(updated);
    all[idx] = updated;
    writeJson0600(this.file, { profiles: all });
    return updated;
  }

  remove(id: string): void {
    const all = this.list().filter((p) => p.id !== id);
    if (all.length === this.list().length) throw new HemError("NOT_FOUND", "پروفایل یافت نشد.");
    writeJson0600(this.file, { profiles: all });
  }

  private validate(p: Profile): void {
    if (!p.name?.trim()) throw new HemError("VALIDATION_FAILED", "نام پروفایل الزامی است.");
    if (!p.host?.trim()) throw new HemError("VALIDATION_FAILED", "آدرس سرور (host) الزامی است.");
    if (!p.username?.trim()) throw new HemError("VALIDATION_FAILED", "نام کاربری الزامی است.");
    if (!Number.isInteger(p.port) || p.port <= 0 || p.port > 65535) {
      throw new HemError("VALIDATION_FAILED", "پورت باید عددی بین ۱ تا ۶۵۵۳۵ باشد.");
    }
    if (p.authMethod === "key" && !p.keyPath?.trim()) {
      throw new HemError("VALIDATION_FAILED", "برای احراز هویت با کلید، مسیر فایل کلید الزامی است.");
    }
    if (p.hsMode === "custom" && !p.hsCustomPrefix?.trim()) {
      throw new HemError(
        "VALIDATION_FAILED",
        "برای حالت custom، پیشوند اجرای headscale (hsCustomPrefix) الزامی است.",
      );
    }
  }
}

/** known_hosts.json — map host:port → confirmed fingerprint (TOFU) */
export class KnownHosts {
  private file: string;

  constructor(home: string) {
    ensureDir(home);
    this.file = path.join(home, "known_hosts.json");
    if (!fs.existsSync(this.file)) {
      writeJson0600(this.file, { hosts: {} });
    }
  }

  private read(): Record<string, KnownHostEntry> {
    return readJson<{ hosts: Record<string, KnownHostEntry> }>(this.file, { hosts: {} }).hosts ?? {};
  }

  private write(data: Record<string, KnownHostEntry>): void {
    writeJson0600(this.file, { hosts: data });
  }

  static key(host: string, port: number): string {
    return `${host}:${port}`;
  }

  get(host: string, port: number): KnownHostEntry | undefined {
    return this.read()[KnownHosts.key(host, port)];
  }

  set(host: string, port: number, entry: Omit<KnownHostEntry, "firstSeen">): KnownHostEntry {
    const all = this.read();
    const full: KnownHostEntry = { ...entry, firstSeen: new Date().toISOString() };
    all[KnownHosts.key(host, port)] = full;
    this.write(all);
    return full;
  }

  forget(host: string, port: number): boolean {
    const all = this.read();
    const k = KnownHosts.key(host, port);
    if (!(k in all)) return false;
    delete all[k];
    this.write(all);
    return true;
  }

  list(): Record<string, KnownHostEntry> {
    return this.read();
  }
}
