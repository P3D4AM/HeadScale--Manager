// انواع مشترک hem-agent — قرارداد AGENT-API.md (سند مرجع)
// همهٔ پیام‌های کاربر فارسی است؛ رشته‌های فنی (کدها/دستورات) انگلیسی می‌مانند.

// ---------------------------------------------------------------------------
// خطاها (§3.5 + چند کد عملیاتی مورد نیاز پیاده‌سازی؛ انحراف‌ها مستند شده)
// ---------------------------------------------------------------------------
export type ErrorCode =
  | "AUTH_FAILED"
  | "CONNECT_TIMEOUT"
  | "CONNECT_FAILED"
  | "HOSTKEY_CHANGED"
  | "FINGERPRINT_REQUIRED"
  | "NOT_CONNECTED"
  | "EXEC_FAILED"
  | "PARSE_FAILED"
  | "NEED_CONFIRM"
  | "UNSUPPORTED"
  | "SUDO_REQUIRED"
  | "VALIDATION_FAILED"
  | "COMMAND_BLOCKED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_IMPLEMENTED_YET"
  | "NOT_AVAILABLE"
  | "INTERNAL";

export interface ApiErrorBody {
  ok: false;
  error: ErrorCode;
  message: string; // فارسی
  detail?: unknown;
}

// ---------------------------------------------------------------------------
// پروفایل‌ها (بدون هیچ سری) — profiles.json در ~/.hem-agent (0600)
// ---------------------------------------------------------------------------
export type AuthMethod = "password" | "key";
/** حالت اجرای headscale روی سرور */
export type HsMode = "system-sudo" | "system" | "custom";

export interface Profile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  /** مسیر فایل کلید «روی ماشین محلی» (مثلاً ~/.ssh/id_ed25519) */
  keyPath?: string;
  hsMode: HsMode;
  /** مثل: /tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml */
  hsCustomPrefix?: string;
  healthUrl?: string;
  logPath?: string;
  configPath?: string;
  /** نحوهٔ فراخوانی hsctl روی سرور: 'hsctl' (PATH — پیش‌فرض) یا مسیر فایل اسکریپت (مثل /opt/headscale-easy-manager/hsctl) */
  hsctlPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  authMethod: AuthMethod;
  keyPath?: string;
  hsMode?: HsMode;
  hsCustomPrefix?: string;
  healthUrl?: string;
  logPath?: string;
  configPath?: string;
  hsctlPath?: string;
}

// ---------------------------------------------------------------------------
// نشست‌ها و اثرانگشت کلید میزبان (TOFU دو مرحله‌ای — §3)
// ---------------------------------------------------------------------------
export interface HostKeyFingerprint {
  algo: string; // مثل ssh-ed25519 / ssh-rsa
  hash: string; // مثل SHA256:BASE64…
  base64Md5: string; // مثل AA:BB:CC:… (hex با جداکننده)
}

export interface KnownHostEntry {
  algo: string;
  sha256: string; // همان فرمت hash بالا
  firstSeen: string;
}

export type SessionStatus =
  | "connecting"
  | "fingerprint-required"
  | "connected"
  | "disconnected"
  | "error";

export type SudoMode = "root" | "nopasswd" | "password" | "none";

export interface ConnectInline {
  host: string;
  port?: number;
  username: string;
  authMethod: AuthMethod;
  password?: string;
  keyPath?: string;
  keyContent?: string;
  passphrase?: string;
  hsMode?: HsMode;
  hsCustomPrefix?: string;
  healthUrl?: string;
  logPath?: string;
  configPath?: string;
  hsctlPath?: string;
}

export interface ConnectRequest {
  profileId?: string;
  inline?: ConnectInline;
  /** استفاده مجدد از شناسهٔ نشست قبلی (بعد از قطع قبلی) */
  sessionId?: string;
  /** اگر کاربر اثرانگشت را از قبل پذیرفته (نمایش در UI) — کلید جدید TOFU بلافاصله پذیرفته می‌شود */
  fingerprintAccept?: boolean;
}

export interface ServerInfo {
  banner?: string;
  fingerprint?: HostKeyFingerprint;
}

export interface ConnectResponse {
  status: "fingerprint-required" | "connected" | "declined";
  sessionId: string;
  fingerprint?: HostKeyFingerprint;
  sudoMode?: SudoMode;
  serverInfo?: ServerInfo;
  warning?: string;
}

export interface SessionInfo {
  id: string;
  status: SessionStatus;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  profileId?: string;
  hsMode: HsMode;
  sudoMode?: SudoMode;
  createdAt: string;
  connectedAt?: string;
  fingerprint?: HostKeyFingerprint;
  lastError?: string;
}

export interface ConnStatusEvent {
  sessionId: string;
  status: "connected" | "disconnected" | "error";
  detail?: string;
}

// ---------------------------------------------------------------------------
// exec
// ---------------------------------------------------------------------------
export interface ExecOptions {
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  stdin?: string;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

// ---------------------------------------------------------------------------
// حسابرسی (audit JSONL)
// ---------------------------------------------------------------------------
export interface AuditEntry {
  ts: string;
  sessionId?: string;
  action: string;
  target?: string;
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// ProbeResult (§6) — فقط از خروجی واقعی دستورات
// ---------------------------------------------------------------------------
export interface ProbeOs {
  id: string;
  versionId: string;
  pretty: string;
  arch: string;
}
export interface ProbePython3 {
  version: string | null;
  hasYaml: boolean;
}
export interface ProbeSystemd {
  available: boolean;
  initPid: number | null;
}
export interface ProbeDisk {
  rootGb: number;
  availGb: number;
}
export interface ProbeMem {
  totalMb: number;
  availMb: number;
}
export interface ProbeCpu {
  cores: number;
}
export interface ProbeNet {
  publicIp: string | null;
  isCgnat: boolean | null;
  addresses: string[];
}
export interface ProbePort {
  proto: string;
  local: string;
  port: number | null;
  process: string | null;
}
export interface ProbeFirewall {
  ufw: "active" | "inactive" | "not-installed";
  otherRules: boolean;
}
export interface ProbeExistingApp {
  installed: boolean;
  version: string | null;
  serviceActive: boolean | null;
}
export interface ProbeExisting {
  headscale: ProbeExistingApp;
  caddy: ProbeExistingApp;
  nginx: ProbeExistingApp;
}
export interface ProbeHemInstalled {
  stateFile: boolean;
  hsctlOnPath: boolean;
}
export interface ProbeResult {
  os: ProbeOs;
  kernel: string;
  python3: ProbePython3;
  systemd: ProbeSystemd;
  disk: ProbeDisk;
  mem: ProbeMem;
  cpu: ProbeCpu;
  net: ProbeNet;
  ports: ProbePort[];
  firewall: ProbeFirewall;
  sudo: { mode: SudoMode };
  existing: ProbeExisting;
  headscaleConfigExists: boolean;
  hemInstalled: ProbeHemInstalled;
  warnings: string[]; // فارسی
  blockers: string[]; // فارسی
  probedAt: string;
}

// ---------------------------------------------------------------------------
// اشیای headscale (نمای نرمال‌شده + نگه‌داشتن فیلدهای خام برای UI)
// ---------------------------------------------------------------------------
export interface HsTimestamp {
  seconds?: number;
  nanos?: number;
}

export interface HsUser {
  id: number;
  name: string;
  displayName?: string | null;
  email?: string | null;
  createdAt?: string | null;
  /** آبجکت خام خروجی CLI برای فیلدهای آینده */
  raw?: Record<string, unknown>;
}

export interface HsNode {
  id: number;
  name: string;
  user?: { id?: number; name?: string } | null;
  ipAddresses?: string[];
  lastSeen?: string | null;
  expiry?: string | null;
  online?: boolean | null;
  approvedRoutes?: string[];
  availableRoutes?: string[];
  raw?: Record<string, unknown>;
}

export interface HsRouteEntry {
  id?: number;
  node?: number | string | null;
  hostname?: string | null;
  prefix?: string | null;
  advertised?: boolean | null;
  enabled?: boolean | null;
  isPrimary?: boolean | null;
  raw?: Record<string, unknown>;
}

export interface HsPreAuthKey {
  id: number;
  user: { id?: number; name?: string };
  /** همیشه ماسک‌شده از CLI می‌آید (hskey-auth-…-***) */
  key: string;
  reusable: boolean;
  ephemeral?: boolean;
  expiration?: string | null;
  createdAt?: string | null;
  raw?: Record<string, unknown>;
}

export interface HsApiKey {
  id: number;
  /** ماسک‌شده (hskey-api-…-***) */
  prefix: string;
  expiration?: string | null;
  createdAt?: string | null;
  raw?: Record<string, unknown>;
}

export interface HsVersion {
  version: string;
  raw: string;
}

export interface PolicyInfo {
  policy: string | null;
  format: "hujson" | "json";
}

export interface PreAuthKeyCreateResult {
  key: string; // کلید کامل — فقط یک بار برمی‌گردد
  expiration: string;
  reusable: boolean;
  ephemeral: boolean;
  tags: string[];
  warning: string;
}

export interface ApiKeyCreateResult {
  key: string; // کلید کامل — فقط یک بار برمی‌گردد
  expiration: string;
  warning: string;
}

// ---------------------------------------------------------------------------
// سرویس / لاگ / سلامت
// ---------------------------------------------------------------------------
export type ServiceActionName = "start" | "stop" | "restart" | "enable" | "disable";

export interface ServiceStatus {
  unit: string;
  available: boolean;
  active: boolean | null;
  enabled: "enabled" | "disabled" | null;
  via: "systemctl" | "process";
  output: string[];
}

export interface LogsResult {
  unit: string;
  source: "journalctl" | "file";
  lines: string[];
  note?: string;
}

export interface HealthLayer {
  ok: boolean;
  via: string;
  detail: string;
}

export interface HealthResult {
  healthy: boolean;
  healthUrl: string;
  layers: {
    service: HealthLayer;
    http: HealthLayer;
    cli: HealthLayer;
  };
}

export interface ConfigValidateResult {
  valid: boolean;
  error?: string;
  checkedWith: string;
}

export interface ConfigSetResult {
  ok: boolean;
  backupPath?: string;
  validated: boolean;
  restarted: boolean;
  health?: HealthResult;
  restored?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// نصب (§8) — مخزن پایتون «منبع واحد» است؛ agent فقط هماهنگ‌کننده است
// ---------------------------------------------------------------------------

/** ورودی‌های فرم نصب — کلیدها عیناً answers.py / examples/hem-install.conf.example */
export interface InstallSettings {
  domain?: string;
  acme_email?: string;
  headscale_version?: string;
  first_user?: string;
  magic_dns_base?: string;
  dns_nameservers?: string[];
  caddy_mode?: "install" | "reuse" | "skip";
  embedded_derp?: boolean;
  firewall?: boolean;
  ssh_port?: number | string | null;
  cameras?: Array<Record<string, unknown>>;
  install_dir?: string;
}

/** شرح یک ورودی پلان نصب (برای UI) */
export interface PlanInputField {
  key: string;
  label: string; // فارسی
  type: "string" | "boolean" | "number" | "enum" | "string[]" | "object[]";
  required: boolean;
  default?: unknown;
  enum?: string[];
  hint?: string; // فارسی
  /** کلیدهایی که agent خودش مقدار می‌دهد (non_interactive و…) */
  agentManaged?: boolean;
}

/** یک گام تجزیه‌شده از خروجی hsctl (الگوی واقعی: «[✓] گام N/total — عنوان — جزئیات») */
export interface ParsedInstallStep {
  stage: number;
  total: number;
  title: string;
  status: "running" | "ok" | "needs_action" | "failed";
  detail?: string;
  risk?: "safe" | "risky";
}

// ---------------------------------------------------------------------------
// پشتیبان / بازیابی / ارتقا (§4)
// ---------------------------------------------------------------------------

export interface BackupEntry {
  name: string;
  sizeMb: number;
}

export interface UpdateCheckResult {
  current: string | null;
  latest: string;
  upToDate: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// allowlist کنسول (§9)
// ---------------------------------------------------------------------------
export interface AllowlistContext {
  /** میزبان پروفایل — curl فقط به همین میزبان/localhost مجاز است */
  host?: string;
}

export interface AllowlistResult {
  allowed: boolean;
  reason?: string; // فارسی
  /** رشتهٔ دقیقی که اجرا می‌شود (argv آرایه‌ای بازساخته‌شده با quoting امن) */
  exactCommand: string;
  argv: string[];
}

// ---------------------------------------------------------------------------
// job ها (§5) — با بافر حلقه‌ای لاگ برای اتصال دیرهنگام / REST fallback
// ---------------------------------------------------------------------------
export interface JobInfo {
  id: string;
  type: string;
  sessionId: string;
  startedAt: string;
  cancelled: boolean;
  /** running | done | error — پس از پایان هم رکورد تا مدتی نگه داشته می‌شود */
  status?: "running" | "done" | "error";
  ok?: boolean;
  exitCode?: number | null;
  summary?: string;
  finalState?: string;
  finishedAt?: string;
  logCount?: number;
}

export interface JobLogLine {
  /** شمارهٔ ترتیبی خط — مبنای ?since= در REST fallback */
  seq: number;
  line: string;
  stream: "stdout" | "stderr";
}

export interface JobLogPage {
  logs: JobLogLine[];
  /** برای صفحهٔ بعدی بفرستید */
  nextSince: number;
  /** true یعنی بخشی از ابتدای لاگ (بیش از ۵۰۰ خط) دیگر در بافر نیست */
  truncated: boolean;
}

export interface JobLogEvent {
  jobId: string;
  line: string;
  stream: "stdout" | "stderr";
}
export interface JobStageEvent {
  jobId: string;
  stage: number;
  total: number;
  title: string;
  risk?: string;
}
export interface JobProgressEvent {
  jobId: string;
  pct: number;
}
export interface JobDoneEvent {
  jobId: string;
  ok: boolean;
  exitCode: number | null;
  summary: string;
  /** وضعیت نهایی نصب (verified/full_success/pending_verification/service_not_ready/partial_failure) یا وضعیت ارتقا (rolled_back/…) */
  finalState?: string;
}
export interface JobErrorEvent {
  jobId: string;
  error: string;
}
