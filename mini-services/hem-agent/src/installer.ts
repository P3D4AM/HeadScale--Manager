// جریان نصب (قرارداد §8) — مخزن پایتون «منبع واحد» است؛ agent فقط:
//   ۱) مخزن را tar می‌زند و روی سرور بارگذاری/استخراج می‌کند (prepare)
//   ۲) پاسخ‌ها را اعتبارسنجی و رندر کرده و dry-run واقعی install.sh را اجرا و
//      خروجی واقعی را تجزیه می‌کند (validate)
//   ۳) نصب واقعی را با sudo و استریم زندهٔ job اجرا می‌کند (execute)
//   ۴) state.json سرور را می‌خواند (state)
// هیچ‌چیز جعلی نیست: خروجی/کد خروج عیناً از hsctl واقعی می‌آید.

import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HemError } from "./errors";
import type { AuditLogger } from "./audit";
import type { JobManager } from "./events";
import { buildSudoInvocation } from "./sudo";
import type { SessionManager } from "./sessions";
import { shellQuote, type SshSession } from "./ssh";
import { createJobStreamer, detectFinalState, parseStepLine } from "./jobstream";
import type { InstallSettings, PlanInputField, ParsedInstallStep } from "./types";
import { installerRootErrorMessage, installerRootStatus } from "./config";

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const wrap =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: (e: unknown) => void): void => {
    fn(req, res).catch(next);
  };

function paramOf(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export interface InstallerDeps {
  manager: SessionManager;
  audit: AuditLogger;
  jobs: JobManager;
}

// ---------------------------------------------------------------------------
// اسکیمای ورودی‌های نصب — «دستی» هم‌گام با منبع واحد نگه داشته می‌شود:
//   examples/hem-install.conf.example + src/hem/installer/answers.py
// تست test/installer.test.ts کلیدهای فایل نمونه را با این لیست مطابقت می‌دهد
// تا هر تغییر سمت پایتون بدون به‌روزرسانی agent فوراً قرمز شود.
// ---------------------------------------------------------------------------
export const PLAN_INPUTS: PlanInputField[] = [
  {
    key: "non_interactive",
    label: "اجرای بدون پرسش (غیرتعاملی)",
    type: "boolean",
    required: false,
    default: true,
    agentManaged: true,
    hint: "agent خودش مقدار true می‌دهد — کلید اجرایی است، نه ورودی کاربر.",
  },
  {
    key: "install_dir",
    label: "مسیر نصب ابزار روی سرور",
    type: "string",
    required: false,
    default: "/opt/headscale-easy-manager",
  },
  {
    key: "domain",
    label: "دامنهٔ سرور (FQDN)",
    type: "string",
    required: true,
    hint: "رکورد A این دامنه باید به IP عمومی سرور اشاره کند.",
  },
  {
    key: "acme_email",
    label: "ایمیل گواهی Let's Encrypt",
    type: "string",
    required: false,
    default: "",
    hint: "اختیاری ولی توصیه‌شده (اطلاع از انقضا).",
  },
  {
    key: "headscale_version",
    label: "نسخهٔ headscale",
    type: "string",
    required: false,
    default: "0.29.5",
    hint: "خالی = نسخهٔ پین‌شدهٔ پروژه. قالب: X.Y.Z",
  },
  {
    key: "first_user",
    label: "نام اولین کاربر شبکه",
    type: "string",
    required: false,
    default: "admin",
    hint: "بدون فاصله.",
  },
  {
    key: "magic_dns_base",
    label: "دامنهٔ MagicDNS",
    type: "string",
    required: true,
    hint: "الزامی و باید با «domain» متفاوت باشد (قید رسمی Headscale).",
  },
  {
    key: "dns_nameservers",
    label: "سرورهای DNS شبکه",
    type: "string[]",
    required: false,
    default: ["1.1.1.1", "8.8.8.8"],
    hint: "لیست IP — هر مقدار باید IP معتبر باشد.",
  },
  {
    key: "caddy_mode",
    label: "حالت پروکسی معکوس (Caddy)",
    type: "enum",
    required: false,
    default: "install",
    enum: ["install", "reuse", "skip"],
    hint: "install = نصب Caddy جدید (توصیه‌شده) | reuse = Caddy موجود | skip = بدون پروکسی (فقط تست).",
  },
  {
    key: "embedded_derp",
    label: "سرور DERP تعبیه‌شده",
    type: "boolean",
    required: false,
    default: true,
    hint: "نیازمند HTTPS؛ با caddy_mode=skip باید خاموش باشد.",
  },
  {
    key: "firewall",
    label: "تنظیم فایروال UFW",
    type: "boolean",
    required: false,
    default: true,
    hint: "پورت SSH فعلی همیشه اول مجاز می‌شود.",
  },
  {
    key: "ssh_port",
    label: "پورت SSH سرور",
    type: "number",
    required: false,
    default: "",
    hint: "خالی = تشخیص خودکار. عددی بین ۱ تا ۶۵۵۳۵.",
  },
  {
    key: "cameras",
    label: "دوربین‌های مداربسته",
    type: "object[]",
    required: false,
    default: [],
    hint: "اختیاری — بعد از نصب هم با «hsctl cameras add» شدنی است.",
  },
];

// ---------------------------------------------------------------------------
// اعتبارسنجی سمت agent — آینهٔ InstallAnswers.validate (answers.py)
// ---------------------------------------------------------------------------
// عین prompts.py (منبع واحد):
const FQDN_RE = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidIp(v: string): boolean {
  const m = IPV4_RE.exec(v);
  if (m) return m.slice(1).every((o) => Number(o) <= 255);
  // IPv6 ساده (فرم کامل/فشرده) — اعتبارسنجی نهایی با نصب‌کننده واقعی است
  return /^[0-9a-fA-F:]+$/.test(v) && v.includes("::") || /^[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{0,4}){7}$/.test(v);
}

export function validateSettings(settings: unknown): string[] {
  const s = (settings ?? {}) as InstallSettings;
  const errors: string[] = [];

  const domain = typeof s.domain === "string" ? s.domain.trim() : "";
  if (!FQDN_RE.test(domain)) {
    errors.push(`دامنهٔ سرور نامعتبر است: «${domain || "—"}» — باید FQDN باشد (مثل hs.example.com).`);
  }

  const magic = typeof s.magic_dns_base === "string" ? s.magic_dns_base.trim() : "";
  if (!magic) errors.push("دامنهٔ MagicDNS الزامی است.");
  else if (!FQDN_RE.test(magic)) errors.push(`دامنهٔ MagicDNS نامعتبر است: «${magic}».`);
  else if (magic === domain) errors.push("دامنهٔ MagicDNS باید با دامنهٔ سرور متفاوت باشد (قید رسمی Headscale).");

  const caddy = s.caddy_mode;
  if (caddy !== "install" && caddy !== "reuse" && caddy !== "skip") {
    errors.push(`حالت caddy باید یکی از install/reuse/skip باشد؛ مقدار دریافتی: «${String(caddy ?? "—")}».`);
  }
  if (caddy === "skip" && s.embedded_derp === true) {
    errors.push("سرور DERP تعبیه‌شده به HTTPS نیاز دارد؛ با caddy_mode=skip باید embedded_derp خاموش باشد.");
  }

  const ns = Array.isArray(s.dns_nameservers) ? s.dns_nameservers : [];
  if (ns.length === 0 && s.dns_nameservers !== undefined) {
    errors.push("فهرست سرورهای DNS نمی‌تواند خالی باشد.");
  }
  for (const n of ns) {
    if (!isValidIp(String(n))) errors.push(`سرور DNS نامعتبر: «${String(n)}» — باید IP معتبر باشد.`);
  }

  const firstUser = typeof s.first_user === "string" ? s.first_user : firstUserDefault(s);
  if (!firstUser || firstUser.includes(" ")) {
    errors.push("نام اولین کاربر نمی‌تواند خالی یا دارای فاصله باشد.");
  }

  const portRaw = s.ssh_port;
  if (portRaw !== undefined && portRaw !== null && portRaw !== "") {
    const p = typeof portRaw === "string" ? Number(portRaw) : portRaw;
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      errors.push("پورت SSH باید عددی بین ۱ تا ۶۵۵۳۵ باشد (یا خالی برای تشخیص خودکار).");
    }
  }

  const ver = typeof s.headscale_version === "string" ? s.headscale_version.trim() : "";
  if (ver !== "" && !SEMVER_RE.test(ver)) {
    errors.push(`نسخهٔ headscale باید به قالب X.Y.Z باشد؛ مقدار دریافتی: «${ver}».`);
  }

  const email = typeof s.acme_email === "string" ? s.acme_email.trim() : "";
  if (email !== "" && !EMAIL_RE.test(email)) {
    errors.push("ایمیل گواهی Let's Encrypt نامعتبر است.");
  }

  return errors;
}

function firstUserDefault(s: InstallSettings): string {
  return typeof s.first_user === "string" ? s.first_user : "admin";
}

// ---------------------------------------------------------------------------
// رندر answers.conf — عیناً قالب کلید‌های examples/hem-install.conf.example
// ---------------------------------------------------------------------------
const YAML_SAFE_SCALAR_RE = /^[A-Za-z0-9_/.][A-Za-z0-9_.@:/-]*$/; // با / شروع شدن مجاز است (مسیرها)

function yamlScalar(v: string): string {
  if (YAML_SAFE_SCALAR_RE.test(v)) return v;
  return JSON.stringify(v); // نقل‌قول دوتایی با escape استاندارد
}

export function renderAnswersConf(settings: InstallSettings): string {
  const s = settings;
  const lines: string[] = [];
  lines.push("non_interactive: true");
  lines.push(`install_dir: ${yamlScalar((s.install_dir ?? "/opt/headscale-easy-manager").trim() || "/opt/headscale-easy-manager")}`);
  lines.push(`domain: ${yamlScalar(String(s.domain ?? "").trim())}`);
  lines.push(`acme_email: ${JSON.stringify(typeof s.acme_email === "string" ? s.acme_email.trim() : "")}`);
  const ver = typeof s.headscale_version === "string" ? s.headscale_version.trim() : "";
  lines.push(`headscale_version: ${JSON.stringify(ver)}`);
  lines.push(`first_user: ${yamlScalar(String(s.first_user ?? "admin").trim() || "admin")}`);
  lines.push(`magic_dns_base: ${yamlScalar(String(s.magic_dns_base ?? "").trim())}`);
  const ns = Array.isArray(s.dns_nameservers) && s.dns_nameservers.length > 0 ? s.dns_nameservers : ["1.1.1.1", "8.8.8.8"];
  lines.push("dns_nameservers:");
  for (const n of ns) lines.push(`  - ${yamlScalar(String(n))}`);
  lines.push(`caddy_mode: ${yamlScalar(String(s.caddy_mode ?? "install"))}`);
  lines.push(`embedded_derp: ${s.embedded_derp === false || s.caddy_mode === "skip" ? "false" : "true"}`);
  lines.push(`firewall: ${s.firewall === false ? "false" : "true"}`);
  const portRaw = s.ssh_port;
  if (portRaw === undefined || portRaw === null || portRaw === "") {
    lines.push('ssh_port: ""');
  } else {
    lines.push(`ssh_port: ${typeof portRaw === "number" ? portRaw : Number(portRaw)}`);
  }
  const cams = Array.isArray(s.cameras) ? s.cameras : [];
  if (cams.length === 0) {
    lines.push("cameras: []");
  } else {
    lines.push("cameras:");
    for (const cam of cams) {
      const entries = Object.entries(cam).filter(([, v]) => v !== undefined && v !== null && v !== "");
      if (entries.length === 0) continue; // مدخل خالی → YAML نامعتبر نسازیم
      // قالب عیناً مطابق examples/hem-install.conf.example: هر کلید در خط خودش
      // (نقشهٔ تک‌خطی «- name: x host: y» YAML نامعتبر است — باگ ۶-ب کشف و رفع شد)
      lines.push(`  - ${entries[0][0]}: ${yamlScalar(String(entries[0][1]))}`);
      for (let i = 1; i < entries.length; i++) {
        lines.push(`    ${entries[i][0]}: ${yamlScalar(String(entries[i][1]))}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// ساخت تاربال مخزن (منبع واحد نصب) و بارگذاری روی سرور
// ---------------------------------------------------------------------------
const REMOTE_DIR_PREFIX = "/tmp/hem-install-";

export interface RepoPrepareResult {
  remoteDir: string;
  sizeBytes: number;
}

export async function prepareRepo(ssh: SshSession): Promise<RepoPrepareResult> {
  // توقف صادقانه «پیش از هر تاربال/آپلودی» (v0.3.1 §1): اگر مخزن نصب‌کننده
  // در هیچ‌کدام از کاندیدهای زنجیره نبود، هرگز «آماده/موفق» اعلام نمی‌شود —
  // پیام، همهٔ مسیرهای بررسی‌شده را با نتیجهٔ وجودشان فهرست می‌کند.
  const status = installerRootStatus();
  if (!status.ok) {
    throw new HemError("NOT_FOUND", installerRootErrorMessage(status));
  }
  const root = status.path;
  const tmp = path.join(os.tmpdir(), `hem-repo-${Date.now()}-${randomUUID().slice(0, 6)}.tar.gz`);
  const tar = Bun.spawn(
    [
      "tar",
      "-czf",
      tmp,
      "-C",
      root,
      "--exclude=.git",
      "--exclude=__pycache__",
      "--exclude=.pytest_cache",
      "--exclude=.ruff_cache",
      "--exclude=node_modules",
      "--exclude=*.pyc",
      ".",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const errText = await new Response(tar.stderr).text();
  const code = await tar.exited;
  if (code !== 0) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw new HemError("EXEC_FAILED", "ساخت بستهٔ مخزن نصب (tar) ناموفق بود.", { stderr: errText.trim() });
  }
  const sizeBytes = fs.statSync(tmp).size;
  const buf = fs.readFileSync(tmp);
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* best-effort */
  }

  const remoteDir = `${REMOTE_DIR_PREFIX}${Date.now()}`;
  const mkdirRes = await ssh.exec(`mkdir -p ${shellQuote(remoteDir)}`, { timeoutMs: 15_000 });
  if (mkdirRes.code !== 0) {
    throw new HemError("EXEC_FAILED", "ساخت پوشهٔ موقت روی سرور ناموفق بود.", { stderr: mkdirRes.stderr });
  }
  await ssh.writeFile(`${remoteDir}/repo.tar.gz`, buf, 60_000);
  const extract = await ssh.exec(
    `tar xzf ${shellQuote(`${remoteDir}/repo.tar.gz`)} -C ${shellQuote(remoteDir)} && test -f ${shellQuote(`${remoteDir}/install.sh`)}`,
    { timeoutMs: 90_000 },
  );
  if (extract.code !== 0) {
    throw new HemError("EXEC_FAILED", "استخراج بستهٔ مخزن روی سرور ناموفق بود (install.sh پیدا نشد).", {
      stderr: extract.stderr,
    });
  }
  return { remoteDir, sizeBytes };
}

// ---------------------------------------------------------------------------
// روتر §8
// ---------------------------------------------------------------------------
export function createInstallRouter(deps: InstallerDeps): Router {
  const r = Router({ mergeParams: true });
  const sid = (req: Request): string => paramOf(req.params.sid);

  // POST /api/s/:sid/install/prepare — بارگذاری مخزن + اسکیمای ورودی‌ها
  r.post(
    "/prepare",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sid(req));
      const { remoteDir, sizeBytes } = await prepareRepo(ctx.ssh);
      deps.audit.log({
        sessionId: sid(req),
        action: "install_prepare",
        target: `${remoteDir} (${sizeBytes}B)`,
        ok: true,
      });
      res.json({ ok: true, remoteDir, sizeBytes, planInputsSchema: PLAN_INPUTS });
    }),
  );

  // POST /api/s/:sid/install/validate — dry-run واقعی + خروجی/گام‌های تجزیه‌شده
  // نکته: فلگ --yes مطابق قرارداد 5-a برای عبور از گام «تأیید برنامه» لازم است؛
  // در dry-run هیچ چیزی اعمال نمی‌شود و این رضایت فقط برای «نمایش برنامه» است.
  r.post(
    "/validate",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sid(req));
      const { settings, remoteDir } = req.body ?? {};
      if (typeof remoteDir !== "string" || !remoteDir.startsWith(REMOTE_DIR_PREFIX)) {
        throw new HemError(
          "VALIDATION_FAILED",
          `remoteDir الزامی است — ابتدا POST install/prepare را صدا بزنید و remoteDir برگشتی را بفرستید (الگو: ${REMOTE_DIR_PREFIX}<ts>).`,
        );
      }
      const errors = validateSettings(settings);
      if (errors.length > 0) {
        throw new HemError("VALIDATION_FAILED", "خطاهای تنظیمات نصب:\n  - " + errors.join("\n  - "), { errors });
      }
      const answers = renderAnswersConf((settings ?? {}) as InstallSettings);
      await ctx.ssh.writeFile(`${remoteDir}/answers.conf`, answers, 30_000);
      const run = await ctx.ssh.exec(
        `cd ${shellQuote(remoteDir)} && bash install.sh --dry-run --config answers.conf --non-interactive --yes`,
        { timeoutMs: 240_000 }, // بررسی DNS/IP عمومی شبکه می‌تواند کند باشد
      );
      const steps: ParsedInstallStep[] = [];
      for (const line of (run.stdout + "\n" + run.stderr).split("\n")) {
        const st = parseStepLine(line);
        if (st) steps.push(st);
      }
      const finalState = detectFinalState(run.stdout + "\n" + run.stderr);
      deps.audit.log({
        sessionId: sid(req),
        action: "install_validate",
        target: `${remoteDir} → exit ${run.code}`,
        ok: run.code === 0,
      });
      res.json({
        ok: run.code === 0,
        exitCode: run.code,
        output: run.stdout,
        stderr: run.stderr,
        plan: steps,
        finalState: finalState ?? undefined,
      });
    }),
  );

  // POST /api/s/:sid/install/execute — نصب واقعی به‌صورت job با استریم زنده
  r.post(
    "/execute",
    wrap(async (req, res) => {
      const sid_ = sid(req);
      const ctx = deps.manager.hsContext(sid_);
      const { settings, confirm, remoteDir } = req.body ?? {};
      if (confirm !== true) {
        throw new HemError(
          "NEED_CONFIRM",
          "اجرای نصب واقعی روی سرور تغییرات ماندگار می‌دهد (بسته‌ها، پیکربندی، فایروال، سرویس) — «confirm: true» بفرستید.",
        );
      }
      const errors = validateSettings(settings);
      if (errors.length > 0) {
        throw new HemError("VALIDATION_FAILED", "خطاهای تنظیمات نصب:\n  - " + errors.join("\n  - "), { errors });
      }
      const jobId = `job-${randomUUID().slice(0, 8)}`;
      let cancelFn: () => void = () => undefined;
      deps.jobs.register({
        id: jobId,
        type: "install-execute",
        sessionId: sid_,
        startedAt: Date.now(),
        cancel: () => cancelFn(),
      });
      // پاسخ فوری؛ ادامهٔ کار در پس‌زمینه با رویدادهای job:*
      res.json({ ok: true, jobId });
      void runInstallJob(deps, sid_, ctx, jobId, (settings ?? {}) as InstallSettings, remoteDir, (fn) => (cancelFn = fn));
    }),
  );

  // GET /api/s/:sid/install/state — خواندن /etc/hem/state.json سرور
  r.get(
    "/state",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sid(req));
      const buf = await ctx.ssh.readFile("/etc/hem/state.json", 10_000).catch(() => null);
      if (!buf) {
        res.json({ ok: true, exists: false });
        return;
      }
      try {
        const state = JSON.parse(buf.toString("utf8")) as unknown;
        res.json({ ok: true, exists: true, state });
      } catch {
        res.json({
          ok: true,
          exists: true,
          state: null,
          parseError: "محتوای /etc/hem/state.json قابل تجزیه به JSON نیست.",
        });
      }
    }),
  );

  return r;
}

type HsCtx = ReturnType<SessionManager["hsContext"]>;

async function runInstallJob(
  deps: InstallerDeps,
  sessionId: string,
  ctx: HsCtx,
  jobId: string,
  settings: InstallSettings,
  remoteDir: unknown,
  setCancel: (fn: () => void) => void,
): Promise<void> {
  const jobs = deps.jobs;
  const log = (line: string, stream: "stdout" | "stderr" = "stdout"): void => jobs.jobLog(jobId, line, stream);
  try {
    log("شروع فرایند نصب Headscale Easy Manager …");
    let dir: string;
    if (typeof remoteDir === "string" && remoteDir.startsWith(REMOTE_DIR_PREFIX)) {
      dir = remoteDir;
      log(`استفاده از مخزن آمادهٔ سرور: ${dir}`);
    } else {
      log("مخزن نصب‌کننده روی سرور آماده نیست — در حال بارگذاری (prepare) …");
      const p = await prepareRepo(ctx.ssh);
      dir = p.remoteDir;
      log(`مخزن در ${dir} آماده شد (${p.sizeBytes} بایت).`);
    }

    const answers = renderAnswersConf(settings);
    await ctx.ssh.writeFile(`${dir}/answers.conf`, answers, 30_000);
    log("فایل پاسخ‌های نصب (answers.conf) روی سرور نوشته شد.");

    const sudoMode = ctx.sudoMode ?? (await ctx.refreshSudo().catch(() => "none" as const));
    const invocation = buildSudoInvocation(
      `cd ${shellQuote(dir)} && bash install.sh --config answers.conf --yes --non-interactive`,
      sudoMode,
      ctx.sudoPassword,
    );
    log(`اجرای نصب با دسترسی sudo (حالت: ${sudoMode}) …`);

    const streamer = createJobStreamer(jobs, jobId);
    const { result, cancel } = ctx.ssh.execCancellable(invocation.cmd, {
      timeoutMs: 30 * 60 * 1000, // نصب واقعی (دانلود/نصب بسته) زمان‌بر است
      stdin: invocation.stdin,
      onStdout: streamer.onStdout,
      onStderr: streamer.onStderr,
    });
    setCancel(cancel);
    const r = await result;
    streamer.flush();

    const finalState = detectFinalState(r.stdout + "\n" + r.stderr) ?? undefined;
    const steps = streamer.steps();
    const failed = steps.find((st) => st.status === "failed" || st.status === "needs_action");
    const summary =
      r.code === 0
        ? `نصب با کد خروج ۰ تمام شد${finalState ? ` (وضعیت نهایی: ${finalState})` : ""}.`
        : `نصب ناتمام ماند (کد خروج ${r.code})${failed ? ` — آخرین گام مشکل‌دار: ${failed.title}` : ""}. پیشنهاد: hsctl doctor`;
    jobs.jobDone(jobId, r.code === 0, r.code, summary, finalState);
    deps.audit.log({
      sessionId,
      action: "install_execute",
      target: `${dir} → exit ${r.code}${finalState ? ` (${finalState})` : ""}`,
      ok: r.code === 0,
      error: r.code === 0 ? undefined : summary,
    });
  } catch (e) {
    const he = e instanceof HemError ? e : null;
    const detail = he?.detail as { cancelled?: boolean } | undefined;
    if (detail?.cancelled) {
      const msg = "اجرای نصب به درخواست کاربر لغو شد.";
      log(`✋ ${msg}`, "stderr");
      jobs.jobDone(jobId, false, null, msg);
      deps.audit.log({ sessionId, action: "install_execute", ok: false, error: msg });
      return;
    }
    const msg = he ? he.message : `خطای غیرمنتظره در اجرای نصب: ${String((e as Error)?.message ?? e)}`;
    if (he?.code === "SUDO_REQUIRED") {
      // رفتار صادقانهٔ درست: بدون root/sudo نصب واقعی ممکن نیست — ادعای موفقیت هرگز نیست.
      log(`✗ ${msg}`, "stderr");
      jobs.jobDone(jobId, false, null, `SUDO_REQUIRED — ${msg}`);
    } else {
      log(`✗ ${msg}`, "stderr");
      jobs.jobError(jobId, msg);
    }
    deps.audit.log({ sessionId, action: "install_execute", ok: false, error: msg });
  }
}
