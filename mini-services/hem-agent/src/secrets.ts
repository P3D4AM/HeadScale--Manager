// Secret store — passwords / passphrases / full keys are never written to logs.
//
//  - Windows (win32): Windows Credential Manager via PowerShell + WinRT PasswordVault
//    (real code, runs only on Windows).
//  - Other platforms (Linux/sandbox): dev secrets.json file with 0600 permissions —
//    this mode is dev-only and honestly documented; the Windows desktop product uses PasswordVault.
//
// Default policy: set(persist:false) → the secret stays in agent memory only.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export type SecretBackend = "windows-vault" | "file" | "memory";

export interface SetSecretOptions {
  /** Default false — keep the secret in memory only */
  persist?: boolean;
}

const VAULT_RESOURCE = "hem-agent";

function psEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/** Runs only on Windows — PasswordVault via the WinRT API */
function runPowerShell(script: string): string {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return out.trim();
}

export class SecretStore {
  readonly backend: SecretBackend;
  private memory = new Map<string, string>();
  private file?: string;

  constructor(home: string) {
    // HEM_SECRET_BACKEND=file — dev/test escape hatch: force the portable file
    // backend on Windows too (the product default on win32 is the vault). This
    // lets the file-backend logic be exercised on every platform/CI and allows
    // developers on Windows to opt into the simple dev store.
    const forcedFile = (process.env.HEM_SECRET_BACKEND ?? "").trim().toLowerCase() === "file";
    if (process.platform === "win32" && !forcedFile) {
      this.backend = "windows-vault";
      return;
    }
    this.backend = "file";
    fs.mkdirSync(home, { recursive: true });
    this.file = path.join(home, "secrets.json");
    if (!fs.existsSync(this.file)) {
      // Dev mode: on Windows, Windows Credential Manager is used instead.
      fs.writeFileSync(
        this.file,
        JSON.stringify(
          { _comment: "HEM agent dev secret store (0600). On Windows the real backend is Windows Credential Manager (PasswordVault).", secrets: {} },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
    }
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* best-effort */
    }
  }

  get(key: string): string | undefined {
    const mem = this.memory.get(key);
    if (mem !== undefined) return mem;
    if (this.backend === "windows-vault") {
      try {
        const out = runPowerShell(
          `[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];` +
            `$v=New-Object Windows.Security.Credentials.PasswordVault;` +
            `try{$c=$v.Retrieve('${VAULT_RESOURCE}','${psEscape(key)}');Write-Output $c.Password}catch{}`,
        );
        if (out && out.length > 0) {
          this.memory.set(key, out);
          return out;
        }
      } catch {
        return undefined;
      }
      return undefined;
    }
    if (this.backend === "file" && this.file) {
      try {
        const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as { secrets?: Record<string, string> };
        const v = data.secrets?.[key];
        if (typeof v === "string") {
          this.memory.set(key, v);
          return v;
        }
      } catch {
        /* read failed */
      }
    }
    return undefined;
  }

  set(key: string, value: string, opts: SetSecretOptions = {}): void {
    this.memory.set(key, value);
    if (!opts.persist) return; // default policy: memory only
    if (this.backend === "windows-vault") {
      runPowerShell(
        `[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];` +
          `$v=New-Object Windows.Security.Credentials.PasswordVault;` +
          `try{$old=$v.Retrieve('${VAULT_RESOURCE}','${psEscape(key)}');$v.Remove($old)}catch{};` +
          `$c=New-Object Windows.Security.Credentials.PasswordCredential('${VAULT_RESOURCE}','${psEscape(key)}','${psEscape(value)}');` +
          `$v.Add($c)`,
      );
      return;
    }
    if (this.backend === "file" && this.file) {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8").trim()) as {
        _comment?: string;
        secrets: Record<string, string>;
      };
      data.secrets = data.secrets ?? {};
      data.secrets[key] = value;
      fs.writeFileSync(this.file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
      try {
        fs.chmodSync(this.file, 0o600);
      } catch {
        /* best-effort */
      }
    }
  }

  delete(key: string): void {
    this.memory.delete(key);
    if (this.backend === "windows-vault") {
      runPowerShell(
        `[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];` +
          `$v=New-Object Windows.Security.Credentials.PasswordVault;` +
          `try{$c=$v.Retrieve('${VAULT_RESOURCE}','${psEscape(key)}');$v.Remove($c)}catch{};Write-Output ok`,
      );
      return;
    }
    if (this.backend === "file" && this.file) {
      try {
        const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as {
          _comment?: string;
          secrets: Record<string, string>;
        };
        if (data.secrets && key in data.secrets) {
          delete data.secrets[key];
          fs.writeFileSync(this.file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
        }
      } catch {
        /* ignore */
      }
    }
  }
}
