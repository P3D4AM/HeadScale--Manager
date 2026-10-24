// مخزن اسرار — رمز عبور / passphrase / کلیدهای کامل هرگز در لاگ نوشته نمی‌شوند.
//
//  - ویندوز (win32): Windows Credential Manager از طریق PowerShell + WinRT PasswordVault
//    (کد واقعی است و فقط روی ویندوز اجرا می‌شود).
//  - سایر پلتفرم‌ها (لینوکس/sandbox): فایل توسعه secrets.json با مجوز 0600 —
//    این حالت فقط برای توسعه است و صادقانه مستند شده؛ در محصول دسکتاپ ویندوزی از PasswordVault استفاده می‌شود.
//
// سیاست پیش‌فرض: set(persist:false) → راز فقط در حافظهٔ agent می‌ماند.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export type SecretBackend = "windows-vault" | "file" | "memory";

export interface SetSecretOptions {
  /** پیش‌فرض false — راز فقط در حافظه بماند */
  persist?: boolean;
}

const VAULT_RESOURCE = "hem-agent";

function psEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/** فقط روی ویندوز اجرا می‌شود — PasswordVault با WinRT API */
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
    if (process.platform === "win32") {
      this.backend = "windows-vault";
      return;
    }
    this.backend = "file";
    fs.mkdirSync(home, { recursive: true });
    this.file = path.join(home, "secrets.json");
    if (!fs.existsSync(this.file)) {
      // «توسعه»: روی ویندوز از Windows Credential Manager استفاده می‌شود.
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
        /* خواندن ناموفق */
      }
    }
    return undefined;
  }

  set(key: string, value: string, opts: SetSecretOptions = {}): void {
    this.memory.set(key, value);
    if (!opts.persist) return; // سیاست پیش‌فرض: فقط حافظه
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
