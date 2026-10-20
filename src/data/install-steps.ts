export type StepRisk = 'safe' | 'risky'

export interface InstallStep {
  /** کلید گام در کد نصب‌کننده (src/hem/installer/flow.py → STEP_TITLES) */
  key: string
  order: number
  title: string
  description: string
  risk: StepRisk
}

/**
 * ۱۷ گام نصب — عیناً از STEP_TITLES در
 * headscale-easy-manager/src/hem/installer/flow.py
 * سطح ریسک هم از همان فایل: risky = packages, headscale, configure, dns_https, firewall, start
 */
export const INSTALL_STEPS: InstallStep[] = [
  {
    key: 'welcome',
    order: 1,
    title: 'خوش‌آمد و معرفی',
    description:
      'معرفی برنامه و توضیح مسیر نصب — چه اتفاقی قرار است بیفتد و چه چیزی تغییر می‌کند.',
    risk: 'safe',
  },
  {
    key: 'preflight',
    order: 2,
    title: 'بررسی پیش‌نیازهای سرور',
    description:
      'بررسی دسترسی مدیر (sudo)، سیستم‌عامل و معماری سرور (Ubuntu 22.04/24.04 — amd64/arm64).',
    risk: 'safe',
  },
  {
    key: 'prereq',
    order: 3,
    title: 'بررسی دسترسی‌ها و پیش‌نیاز نرم‌افزاری',
    description:
      'بررسی و نصب python3 و python3-yaml در صورت نبود — پیش‌نیازهای اجرای خود ابزار.',
    risk: 'safe',
  },
  {
    key: 'resources',
    order: 4,
    title: 'بررسی منابع شبکه (IP عمومی و CGNAT)',
    description:
      'تشخیص IP عمومی سرور و بررسی رام/دیسک (حداقل ۱GB RAM و ۱۰GB فضای آزاد).',
    risk: 'safe',
  },
  {
    key: 'detect_services',
    order: 5,
    title: 'شناسایی سرویس‌های موجود',
    description:
      'شناسایی Caddy/Headscale/وب‌سرورهای موجود روی سرور — به سرویس‌های نامرتبط دست نمی‌زند.',
    risk: 'safe',
  },
  {
    key: 'plan',
    order: 6,
    title: 'نمایش برنامه تغییرات و تأیید',
    description:
      'نمایش برنامه کامل تغییرات و گرفتن تأیید صریح شما قبل از هر تغییر واقعی روی سرور.',
    risk: 'safe',
  },
  {
    key: 'gather',
    order: 7,
    title: 'جمع‌آوری پاسخ‌های نصب',
    description:
      'سؤال‌های تعاملی (دامنه، DNS، ایمیل، Caddy، DERP، MagicDNS، فایروال، کاربر اول) یا خواندن فایل پاسخ.',
    risk: 'safe',
  },
  {
    key: 'validate',
    order: 8,
    title: 'اعتبارسنجی DNS دامنه',
    description:
      'تطبیق رکورد A دامنه با IP عمومی سرور — اگر اشتباه باشد، راهنمایی می‌کند و ادامه نمی‌دهد.',
    risk: 'safe',
  },
  {
    key: 'packages',
    order: 9,
    title: 'نصب بسته‌های پایه',
    description: 'نصب بسته‌های سیستمی لازم (مثل sqlite3 و curl) از مخزن رسمی اوبونتو.',
    risk: 'risky',
  },
  {
    key: 'headscale',
    order: 10,
    title: 'دانلود و نصب headscale',
    description:
      'دانلود بستهٔ رسمی headscale v0.29.5 از GitHub Release و راستی‌آزمایی SHA-256 با فایل رسمی checksums.txt، سپس نصب.',
    risk: 'risky',
  },
  {
    key: 'configure',
    order: 11,
    title: 'تولید و اعتبارسنجی پیکربندی',
    description:
      'تولید /etc/headscale/config.yaml مطابق پاسخ‌های شما و اعتبارسنجی آن قبل از اجرا.',
    risk: 'risky',
  },
  {
    key: 'dns_https',
    order: 12,
    title: 'تنظیم پروکسی Caddy و HTTPS',
    description:
      'نصب یا تکمیل Caddy، تزریق بلوک سایت با مارکر اختصاصی و دریافت گواهی معتبر Let’s Encrypt.',
    risk: 'risky',
  },
  {
    key: 'firewall',
    order: 13,
    title: 'تنظیم فایروال (اول SSH)',
    description:
      'تنظیم UFW با اصل حداقل دسترسی — اول پورت SSH فعلی شما مجاز می‌شود تا از سرور بیرون نفتید؛ سپس 80/443 (و 3478/udp در صورت DERP).',
    risk: 'risky',
  },
  {
    key: 'start',
    order: 14,
    title: 'فعال‌سازی سرویس',
    description:
      'فعال‌سازی (enable) و اجرای (start) سرویس headscale با systemd — پس از ری‌استارت سرور هم بالا می‌آید.',
    risk: 'risky',
  },
  {
    key: 'health',
    order: 15,
    title: 'بررسی سلامت و ساخت اولین کاربر',
    description:
      'تست سرویس، گواهی و پاسخ صفحهٔ /health ({"status":"pass"}) و ساخت کاربر اول شبکه با نام انتخابی شما.',
    risk: 'safe',
  },
  {
    key: 'report',
    order: 16,
    title: 'گزارش نصب',
    description:
      'ذخیرهٔ گزارش کامل نصب در /var/log/hem/ و ثبت کارهای انجام‌شده در /etc/hem/state.json برای پشتیبان‌گیری و حذف تمیز.',
    risk: 'safe',
  },
  {
    key: 'next_steps',
    order: 17,
    title: 'گام‌های بعدی شما',
    description:
      'راهنمای اتصال اولین دستگاه (tailscale up)، ساخت کلید اتصال، دسترسی به شبکه دفتر (فصل ۶) و شروع آموزش.',
    risk: 'safe',
  },
]

/** نمونه گفت‌وگوی نصب — از فصل ۴ مستندات (۴.۵ نمونهٔ دیالوگ کامل نصب) */
export interface InstallDialogQA {
  question: string
  hint?: string
  options: string[]
  recommended?: number
  sampleAnswer: string
}

export const INSTALL_DIALOG: InstallDialogQA[] = [
  {
    question: 'دامنه‌ای که برای سرور استفاده می‌کنید چیست؟',
    hint: 'مثال: headscale.example.com — رکورد A آن باید به IP این سرور اشاره کند',
    options: [],
    sampleAnswer: 'headscale.example.com',
  },
  {
    question: 'وضعیت رکورد DNS این دامنه:',
    options: [
      'بله، رکورد A را تنظیم کرده‌ام و به IP سرور اشاره می‌کند',
      'خیر، هنوز تنظیم نکرده‌ام — راهنمایی کن',
      'نمی‌دانم — خودت بررسی کن',
    ],
    recommended: 2,
    sampleAnswer:
      '۳) نمی‌دانم — خودت بررسی کن\n\n[✓] headscale.example.com به 203.0.113.10 اشاره می‌کند — درست است.',
  },
  {
    question: 'HTTPS با Caddy (گواهی خودکار Let’s Encrypt):',
    options: [
      'نصب Caddy جدید (توصیه‌شده)',
      'استفاده از Caddy موجود روی سرور',
      'بدون HTTPS (توصیه نمی‌شود)',
    ],
    recommended: 0,
    sampleAnswer: '۱) نصب Caddy جدید (توصیه‌شده)',
  },
  {
    question: 'سرور رلهٔ DERP تعبیه‌شده روی همین سرور فعال شود؟',
    hint: 'کیفیت اتصال در شبکه‌های سخت را بهتر می‌کند؛ پورت UDP 3478 لازم است [Y/n]',
    options: [],
    sampleAnswer: 'y',
  },
  {
    question: 'فایروال UFW با قواعد حداقلی فعال شود؟',
    hint: 'پورت SSH فعلی شما همیشه مجاز می‌ماند [Y/n]',
    options: [],
    sampleAnswer: 'y',
  },
  {
    question: 'نام کاربر اول شبکه (مثلاً admin):',
    options: [],
    sampleAnswer: 'admin',
  },
]

/** فایل نمونه حالت خودکار — از examples/hem-install.conf.example (بدون مقادیر حساس) */
export const AUTO_INSTALL_CONF_SAMPLE = `# نمونه فایل پاسخ نصب — cp examples/hem-install.conf.example hem-install.conf
# پس از ویرایش: chmod 600 hem-install.conf  (این فایل را محافظت کنید!)

domain: headscale.example.com
dns_status: check            # ok | guide | check
acme_email: ""
caddy_mode: install_new      # install_new | use_existing | none
embedded_derp: true
magic_dns: true
ufw_enabled: true
first_user: admin
`

/** چک‌لیست سلامت پس از نصب — سه تست فصل ۴ */
export interface HealthCheck {
  title: string
  command: string
  expected: string
}

export const POST_INSTALL_CHECKS: HealthCheck[] = [
  {
    title: '۱) سرویس در حال اجراست؟',
    command: 'sudo systemctl status headscale',
    expected:
      '● headscale.service - headscale coordination server for Tailscale\n   Active: active (running) since Fri 2025-01-10 12:00:00 UTC; 3min ago',
  },
  {
    title: '۲) صفحهٔ سلامت سرور (در مرورگر خودتان)',
    command: 'https://headscale.example.com/health',
    expected: '{"status": "pass"}',
  },
  {
    title: '۳) ابزار مدیریت',
    command: 'hsctl status',
    expected:
      'سرویس headscale     : فعال (running)\nگواهی HTTPS (Caddy) : فعال\nنسخهٔ Headscale     : 0.29.5',
  },
]

/** پرسش‌های پرتکرار نصب — برگرفته از فصل ۴ (خطاهای رایج) و README */
export interface FaqItem {
  question: string
  answer: string
}

export const INSTALL_FAQ: FaqItem[] = [
  {
    question: 'پورت 80 یا 443 روی سرور من اشغال است؛ چه کنم؟',
    answer:
      'معمولاً مقصر nginx، apache یا پنل‌های مدیریت سرور است. یا آن سرویس را غیرفعال کنید (sudo systemctl stop nginx && sudo systemctl disable nginx) و دوباره نصب را اجرا کنید؛ یا اگر به آن نیاز دارید، از گزینهٔ «استفاده از Caddy موجود» استفاده کنید / برای Headscale سرور جدا بگذارید. نصب‌کننده در گام ۵ (شناسایی سرویس‌های موجود) این وضعیت را از قبل تشخیص می‌دهد.',
  },
  {
    question: 'روی سروری هست که از قبل headscale یا سرویس مشابه دارد؛ نصب مجدد امن است؟',
    answer:
      'این نصب‌کننده برای راه‌اندازی تازه طراحی شده است. اگر headscale قبلی دارید، اول از داده‌های فعلی پشتیبان بگیرید و با hsctl restore به نسخهٔ ابزار مهاجرت کنید — بدون پاک‌کردن دیتابیس. اگر سرور اشتباهی انتخاب کرده‌اید، روی VPS تازه‌ای نصب کنید. نصب‌کننده به سرویس‌های نامرتبط دست نمی‌زند و Caddy موجود را با حفظ تنظیماتش تکمیل می‌کند.',
  },
  {
    question: 'هنوز دامنه ندارم / نمی‌توانم رکورد A تنظیم کنم؛ بدون دامنه هم می‌شود؟',
    answer:
      'برای گواهی معتبر Let’s Encrypt و اتصال کلاینت‌های رسمی Tailscale، دامنه با رکورد A درست عملاً لازم است. در دیالوگ نصب، گزینهٔ «راهنمایی کن» را انتخاب کنید تا ساخت رکورد A قدم‌به‌قدم توضیح داده شود؛ بعد از تنظیم DNS، همان sudo ./install.sh را دوباره اجرا کنید — گام‌های انجام‌شده تکرار نمی‌شوند.',
  },
  {
    question: 'بعداً چطور به نسخهٔ جدید Headscale ارتقا بدهم؟',
    answer:
      'با hsctl update --check نسخهٔ جدید را ببینید و با hsctl update ارتقا بدهید. ارتقا نسخه‌به‌نسخه و بدون پرش minor است (مثلاً 0.27 → 0.28 → 0.29) و ابزار خودش این را چک می‌کند و هشدار می‌دهد. ترتیب رسمی: توقف → پشتیبان → نصب نسخهٔ جدید → به‌روزرسانی پیکربندی → اجرا. همهٔ این‌ها خودکار انجام می‌شود.',
  },
  {
    question: 'اگر خواستم همه‌چیز را حذف کنم چه می‌شود؟',
    answer:
      'hsctl uninstall فقط کارهایی که خود ابزار انجام داده را برمی‌گرداند (بر اساس ثبت دقیق /etc/hem/state.json) و پشتیبان‌ها را حفظ می‌کند. با --purge-data داده‌های شبکه هم پاک می‌شوند — قبلش از پشتیبان مطمئن شوید. دستور در هر مرحله تأیید صریح می‌گیرد.',
  },
]
