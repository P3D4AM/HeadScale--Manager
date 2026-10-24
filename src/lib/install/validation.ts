'use client'

/**
 * اعتبارسنجی سمت کلاینتِ تنظیمات نصب — آینهٔ validateSettings واقعی در
 * hem-agent (src/installer.ts) + قید ایمیل ACME برای حالت‌های HTTPS
 * (caddy_mode ≠ skip) طبق طراحی ویزارد.
 *
 * هدف: خطاها را «قبل از» ارسال به سرور به فارسی نشان بدهیم؛ اعتبارسنجی
 * نهایی و مرجع همیشه همان نصب‌کنندهٔ واقعی روی سرور است.
 */

import type { CameraDevice, InstallSettings } from './types'

// عیناً از installer.ts (منبع واحد: prompts.py)
const FQDN_RE =
  /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const SEMVER_RE = /^\d+\.\d+\.\d+$/
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function isValidFqdn(v: string): boolean {
  return FQDN_RE.test(v.trim())
}

function isValidIp(v: string): boolean {
  const m = IPV4_RE.exec(v.trim())
  if (m) return m.slice(1).every((o) => Number(o) <= 255)
  // IPv6 ساده — اعتبارسنجی نهایی با نصب‌کنندهٔ واقعی است
  return (
    (/^[0-9a-fA-F:]+$/.test(v) && v.includes('::')) ||
    /^[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{0,4}){7}$/.test(v)
  )
}

export interface InstallFormValidation {
  /** خطا به‌ازای کلید فیلد */
  fieldErrors: Record<string, string>
  /** خطای دوربین به‌ازای اندیس در آرایهٔ cameras */
  cameraErrors: Record<number, string>
  /** خطاهای کلی (به فیلد خاصی وصل نیستند) */
  general: string[]
}

export function isCaddyHttpsMode(mode: InstallSettings['caddy_mode']): boolean {
  return mode === 'install' || mode === 'reuse'
}

/** اعتبارسنجی کامل فرم — خالی یعنی معتبر */
export function validateInstallSettings(s: InstallSettings): InstallFormValidation {
  const fieldErrors: Record<string, string> = {}
  const cameraErrors: Record<number, string> = {}
  const general: string[] = []

  const domain = (s.domain ?? '').trim()
  if (!domain) {
    fieldErrors.domain = 'دامنهٔ سرور الزامی است.'
  } else if (!isValidFqdn(domain)) {
    fieldErrors.domain = `دامنهٔ سرور نامعتبر است: «${domain}» — باید FQDN باشد (مثل hs.example.com).`
  }

  const magic = (s.magic_dns_base ?? '').trim()
  if (!magic) {
    fieldErrors.magic_dns_base = 'دامنهٔ MagicDNS الزامی است.'
  } else if (!isValidFqdn(magic)) {
    fieldErrors.magic_dns_base = `دامنهٔ MagicDNS نامعتبر است: «${magic}».`
  } else if (magic === domain) {
    fieldErrors.magic_dns_base =
      'دامنهٔ MagicDNS باید با دامنهٔ سرور متفاوت باشد (قید رسمی Headscale).'
  }

  const caddy = s.caddy_mode
  if (caddy !== 'install' && caddy !== 'reuse' && caddy !== 'skip') {
    fieldErrors.caddy_mode = 'حالت Caddy باید یکی از install / reuse / skip باشد.'
  }
  if (caddy === 'skip' && s.embedded_derp === true) {
    fieldErrors.embedded_derp =
      'سرور DERP تعبیه‌شده به HTTPS نیاز دارد؛ با Caddy = skip باید خاموش باشد.'
  }

  const ns = Array.isArray(s.dns_nameservers) ? s.dns_nameservers : []
  if (ns.length === 0) {
    fieldErrors.dns_nameservers = 'فهرست سرورهای DNS نمی‌تواند خالی باشد.'
  } else {
    const bad = ns.filter((n) => !isValidIp(String(n)))
    if (bad.length > 0) {
      fieldErrors.dns_nameservers = `سرور DNS نامعتبر: «${bad[0]}» — هر مقدار باید IP معتبر باشد.`
    }
  }

  const firstUser = (s.first_user ?? '').trim()
  if (!firstUser) {
    fieldErrors.first_user = 'نام اولین کاربر الزامی است.'
  } else if (firstUser.includes(' ')) {
    fieldErrors.first_user = 'نام اولین کاربر نباید فاصله داشته باشد.'
  }

  const portRaw = s.ssh_port
  if (portRaw !== undefined && portRaw !== null && portRaw !== '') {
    const p = typeof portRaw === 'string' ? Number(portRaw) : portRaw
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      fieldErrors.ssh_port = 'پورت SSH باید عددی بین ۱ تا ۶۵۵۳۵ باشد (یا خالی برای تشخیص خودکار).'
    }
  }

  const ver = (s.headscale_version ?? '').trim()
  if (ver !== '' && !SEMVER_RE.test(ver)) {
    fieldErrors.headscale_version = `نسخهٔ headscale باید به قالب X.Y.Z باشد؛ مقدار فعلی: «${ver}».`
  }

  const email = (s.acme_email ?? '').trim()
  if (email !== '') {
    if (!EMAIL_RE.test(email)) {
      fieldErrors.acme_email = 'ایمیل گواهی Let’s Encrypt نامعتبر است.'
    }
  } else if (isCaddyHttpsMode(caddy)) {
    // قید ویزارد: در حالت HTTPS (نصب/استفاده از Caddy) ایمیل گواهی الزامی است.
    fieldErrors.acme_email =
      'در حالت HTTPS (Caddy = نصب یا موجود) ایمیل گواهی Let’s Encrypt الزامی است — برای اطلاع از انقضا و بازیابی گواهی.'
  }

  const installDir = (s.install_dir ?? '').trim()
  if (!installDir.startsWith('/')) {
    fieldErrors.install_dir = 'مسیر نصب باید مطلق و با «/» شروع شود.'
  }

  // دوربین‌ها: نام و آدرس هر دوربینِ نیمه‌پر الزامی است
  const cams = Array.isArray(s.cameras) ? s.cameras : []
  cams.forEach((cam, i) => {
    const empty =
      !cam.name?.trim() && !cam.host?.trim() && !cam.brand?.trim() && !cam.notes?.trim()
    if (empty) return
    if (!cam.name?.trim()) {
      cameraErrors[i] = 'نام دوربین الزامی است.'
    } else if (!cam.host?.trim()) {
      cameraErrors[i] = 'آدرس/IP دوربین الزامی است.'
    }
  })

  return { fieldErrors, cameraErrors, general }
}

export function isValidationValid(v: InstallFormValidation): boolean {
  return (
    Object.keys(v.fieldErrors).length === 0 &&
    Object.keys(v.cameraErrors).length === 0 &&
    v.general.length === 0
  )
}

/** نسخهٔ تمیزشدهٔ تنظیمات برای ارسال به agent (بدون فیلدهای خالی دوربین) */
export function sanitizeSettingsForSend(s: InstallSettings): InstallSettings {
  const out: InstallSettings = { ...s }
  out.domain = (s.domain ?? '').trim()
  out.magic_dns_base = (s.magic_dns_base ?? '').trim()
  out.acme_email = (s.acme_email ?? '').trim()
  out.first_user = (s.first_user ?? 'admin').trim() || 'admin'
  out.headscale_version = (s.headscale_version ?? '').trim()
  out.install_dir = (s.install_dir ?? '/opt/headscale-easy-manager').trim() || '/opt/headscale-easy-manager'
  out.cameras = (Array.isArray(s.cameras) ? s.cameras : [])
    .filter((c) => c.name?.trim() && c.host?.trim())
    .map((c: CameraDevice) => {
      const cam: CameraDevice = { name: c.name.trim(), host: c.host.trim() }
      if (Number.isInteger(c.http_port) && (c.http_port as number) > 0) cam.http_port = c.http_port
      if (Number.isInteger(c.rtsp_port) && (c.rtsp_port as number) > 0) cam.rtsp_port = c.rtsp_port
      if (c.brand?.trim()) cam.brand = c.brand.trim()
      if (c.notes?.trim()) cam.notes = c.notes.trim()
      return cam
    })
  return out
}
