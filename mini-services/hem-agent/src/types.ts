// Shared types for hem-agent — per the AGENT-API.md contract (reference document)
// All user-facing messages are Persian (browser UI); technical strings (codes/commands) stay English.

// ---------------------------------------------------------------------------
// Errors (§3.5 + a few operational codes the implementation needs; deviations documented)
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
  message: string; // Persian (browser UI)
  detail?: unknown;
}

// ---------------------------------------------------------------------------
// Profiles (no secrets at all) — profiles.json under ~/.hem-agent (0600)
// ---------------------------------------------------------------------------
export type AuthMethod = "password" | "key";
/** How headscale runs on the server */
export type HsMode = "system-sudo" | "system" | "custom";

export interface Profile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  /** Key file path on the local machine (e.g. ~/.ssh/id_ed25519) */
  keyPath?: string;
  hsMode: HsMode;
  /** e.g.: /tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml */
  hsCustomPrefix?: string;
  healthUrl?: string;
  logPath?: string;
  configPath?: string;
  /** How hsctl is invoked on the server: hsctl on PATH (default) or a script file path (e.g. /opt/headscale-easy-manager/hsctl) */
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
// Sessions and host key fingerprints (two-step TOFU — §3)
// ---------------------------------------------------------------------------
export interface HostKeyFingerprint {
  algo: string; // e.g. ssh-ed25519 / ssh-rsa
  hash: string; // e.g. SHA256:BASE64…
  base64Md5: string; // e.g. AA:BB:CC:… (hex, colon-separated)
}

export interface KnownHostEntry {
  algo: string;
  sha256: string; // same format as hash above
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
  /** Reuse the previous session id (after a prior disconnect) */
  sessionId?: string;
  /** If the user pre-accepted the fingerprint (shown in the UI) — the new TOFU key is accepted immediately */
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
// Audit (JSONL audit log)
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
// ProbeResult (§6) — from real command output only
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
  warnings: string[]; // Persian (browser UI)
  blockers: string[]; // Persian (browser UI)
  probedAt: string;
}

// ---------------------------------------------------------------------------
// headscale objects (normalized view + raw fields kept for the UI)
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
  /** Raw CLI output object for future fields */
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
  /** Always comes masked from the CLI (hskey-auth-…-***) */
  key: string;
  reusable: boolean;
  ephemeral?: boolean;
  expiration?: string | null;
  createdAt?: string | null;
  raw?: Record<string, unknown>;
}

export interface HsApiKey {
  id: number;
  /** Masked (hskey-api-…-***) */
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
  key: string; // full key — returned only once
  expiration: string;
  reusable: boolean;
  ephemeral: boolean;
  tags: string[];
  warning: string;
}

export interface ApiKeyCreateResult {
  key: string; // full key — returned only once
  expiration: string;
  warning: string;
}

// ---------------------------------------------------------------------------
// Service / logs / health
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
// Install (§8) — the Python repo is the single source; the agent is only a coordinator
// ---------------------------------------------------------------------------

/** Install form inputs — keys exactly as in answers.py / examples/hem-install.conf.example */
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

/** Description of one install-plan input (for the UI) */
export interface PlanInputField {
  key: string;
  label: string; // Persian (browser UI)
  type: "string" | "boolean" | "number" | "enum" | "string[]" | "object[]";
  required: boolean;
  default?: unknown;
  enum?: string[];
  hint?: string; // Persian (browser UI)
  /** Keys the agent sets itself (non_interactive etc.) */
  agentManaged?: boolean;
}

/** One step parsed from hsctl output (real pattern: [✓] Step N/total — title — detail) */
export interface ParsedInstallStep {
  stage: number;
  total: number;
  title: string;
  status: "running" | "ok" | "needs_action" | "failed";
  detail?: string;
  risk?: "safe" | "risky";
}

// ---------------------------------------------------------------------------
// Backup / restore / update (§4)
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
// Console allowlist (§9)
// ---------------------------------------------------------------------------
export interface AllowlistContext {
  /** Profile host — curl is allowed only to this host/localhost */
  host?: string;
}

export interface AllowlistResult {
  allowed: boolean;
  reason?: string; // Persian (browser UI)
  /** The exact string that will be executed (argv rebuilt as an array with safe quoting) */
  exactCommand: string;
  argv: string[];
}

// ---------------------------------------------------------------------------
// Jobs (§5) — with a ring-buffered log for late subscribers / REST fallback
// ---------------------------------------------------------------------------
export interface JobInfo {
  id: string;
  type: string;
  sessionId: string;
  startedAt: string;
  cancelled: boolean;
  /** running | done | error — the record is kept for a while after completion */
  status?: "running" | "done" | "error";
  ok?: boolean;
  exitCode?: number | null;
  summary?: string;
  finalState?: string;
  finishedAt?: string;
  logCount?: number;
}

export interface JobLogLine {
  /** Line sequence number — the basis of ?since= in the REST fallback */
  seq: number;
  line: string;
  stream: "stdout" | "stderr";
}

export interface JobLogPage {
  logs: JobLogLine[];
  /** Send this for the next page */
  nextSince: number;
  /** true means part of the beginning of the log (beyond 500 lines) is no longer buffered */
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
  /** Install final state (verified/full_success/pending_verification/service_not_ready/partial_failure) or update state (rolled_back/…) */
  finalState?: string;
}
export interface JobErrorEvent {
  jobId: string;
  error: string;
}
