export type CommandGroup = 'hsctl' | 'headscale' | 'tailscale'

export type CommandCategory =
  | 'install'
  | 'status'
  | 'users'
  | 'routes'
  | 'backup'
  | 'cameras'
  | 'learn'
  | 'config'

export type RiskLevel = 'safe' | 'risky' | 'dangerous'

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  install: 'نصب و ارتقا',
  status: 'وضعیت و عیب‌یابی',
  users: 'کاربران و دستگاه‌ها',
  routes: 'مسیرها',
  backup: 'پشتیبان',
  cameras: 'دوربین',
  learn: 'آموزش',
  config: 'پیکربندی',
}

export interface CliCommand {
  group: CommandGroup
  category: CommandCategory
  name: string
  command: string
  description: string
  flags?: string[]
  example?: string
  risk: RiskLevel
  note?: string
}

/**
 * مرجع دستورات — عیناً از docs/FACTS.md:
 * hsctl → §11 (قرارداد رابط) · headscale → §4 (CLI نسخهٔ ۰.۲۹) · tailscale → §5 (جریان‌های رسمی کلاینت)
 */
export const CLI_COMMANDS: CliCommand[] = [
  // ─── hsctl (از FACTS §11) ───────────────────────────────────────────
  {
    group: 'hsctl',
    category: 'learn',
    name: 'help / version',
    command: 'hsctl --help | hsctl --version',
    description: 'راهنمای کلی ابزار و نمایش نسخهٔ نصب‌شده.',
    risk: 'safe',
  },
  {
    group: 'hsctl',
    category: 'install',
    name: 'install',
    command:
      'hsctl install [--config FILE] [--non-interactive] [--dry-run] [--install-dir DIR]',
    description:
      'نصب کامل Headscale روی سرور — همان کاری که install.sh راهبری می‌کند. با --config و --non-interactive بدون سؤال، و با --dry-run فقط نمایش تغییرات.',
    flags: [
      '--config FILE — فایل پاسخ‌ها (نمونه: examples/hem-install.conf.example)',
      '--non-interactive — بدون هیچ سؤال تعاملی',
      '--dry-run — نمایش مراحل بدون اعمال هیچ تغییر واقعی',
      '--install-dir DIR — مسیر نصب (پیش‌فرض /opt/headscale-easy-manager)',
    ],
    example: 'sudo ./install.sh --dry-run',
    risk: 'risky',
  },
  {
    group: 'hsctl',
    category: 'status',
    name: 'status',
    command: 'hsctl status',
    description:
      'وضعیت کلی سرور: سرویس‌ها، دامنه، DNS، فایروال، پورت‌ها و فضای دیسک — جمع‌بندی یک‌صفحه‌ای.',
    risk: 'safe',
  },
  {
    group: 'hsctl',
    category: 'status',
    name: 'doctor',
    command: 'hsctl doctor [--fix] [--json]',
    description:
      'عیب‌یابی خودکار ده‌ها بررسی — برای هر مشکل: مسئله / علت / چگونگی بررسی / راهکار. با --fix اصلاح‌های کم‌خطر خودش اعمال می‌شود.',
    flags: [
      '--fix — تلاش برای اصلاح کم‌خطر',
      '--json — خروجی ماشینی',
    ],
    example: 'hsctl doctor --fix',
    risk: 'safe',
    note: 'همیشه اول doctor — بسیاری از مشکلات با همین یک دستور حل می‌شوند.',
  },
  {
    group: 'hsctl',
    category: 'status',
    name: 'logs',
    command: 'hsctl logs [--lines N] [--since DURATION] [--follow]',
    description:
      'مشاهدهٔ لاگ یکپارچهٔ سرویس (hsctl logs) و رخدادهای ابزار در /var/log/hem/hem.log.',
    flags: [
      '--lines N — تعداد خطوط (مثل 100)',
      '--since DURATION — از چند وقت پیش',
      '--follow — پیگیری زنده (خروج با Ctrl+C)',
    ],
    example: 'hsctl logs --lines 100 --follow',
    risk: 'safe',
  },
  {
    group: 'hsctl',
    category: 'users',
    name: 'users',
    command: 'hsctl users [list] | users create <name> | users delete <name-or-id> [--yes]',
    description:
      'مدیریت کاربران شبکه: فهرست، ساخت و حذف. حذف با --yes تأیید صریح می‌گیرد.',
    example: 'sudo hsctl users create sara',
    risk: 'risky',
  },
  {
    group: 'hsctl',
    category: 'users',
    name: 'devices',
    command: 'hsctl devices [list] | devices delete <id> [--yes]',
    description:
      'فهرست دستگاه‌های متصل به شبکه و حذف دستگاه (مثلاً دستگاه گم‌شده — همراه با انقضای کلیدها طبق فصل ۱۰).',
    example: 'sudo hsctl devices delete 3 --yes',
    risk: 'risky',
  },
  {
    group: 'hsctl',
    category: 'users',
    name: 'preauth',
    command:
      'hsctl preauth create <user> [--reusable] [--expiration 1h] | preauth list <user>',
    description:
      'ساخت و فهرست کلیدهای اتصال از پیش تأییدشده (Preauth Key) — اتصال دستگاه بدون باز شدن مرورگر.',
    flags: [
      '--reusable — قابل استفاده برای چند دستگاه',
      '--expiration 1h — مدت اعتبار (پیش‌فرض موتور headscale: ۱ ساعت)',
    ],
    example: 'sudo hsctl preauth create admin --reusable --expiration 24h',
    risk: 'risky',
    note: 'کلید Preauth فقط یک‌بار و همون لحظه نمایش داده می‌شود — همان‌جا کپی‌اش کنید.',
  },
  {
    group: 'hsctl',
    category: 'routes',
    name: 'routes',
    command:
      'hsctl routes list | routes approve <node-id> --routes <CIDR,CIDR> | routes revoke <node-id> [--yes]',
    description:
      'مدیریت مسیرهای شبکه: فهرست مسیرهای پیشنهادی (Advertised) و تأیید/لغو آن‌ها — قلب دسترسی به شبکهٔ دفتر (فصل ۶).',
    flags: [
      'approve — تأیید مسیرهای یک دستگاه با شناسهٔ عددی نود',
      'revoke — لغو کامل مسیرهای یک دستگاه',
    ],
    example: 'sudo hsctl routes approve 1 --routes 192.168.1.0/24',
    risk: 'risky',
    note: 'routes approve با شناسهٔ عددی نود (ID) کار می‌کند — از hsctl routes list بگیریدش.',
  },
  {
    group: 'hsctl',
    category: 'backup',
    name: 'backup',
    command: 'hsctl backup create [--output FILE] | backup list | backup verify <FILE>',
    description:
      'پشتیبان‌گیری کامل (پیکربندی + دیتابیس SQLite با .backup امن + کلیدها + بلوک Caddy + state) در /var/backups/hem/ و راستی‌آزمایی فایل پشتیبان.',
    example: 'sudo hsctl backup create && sudo hsctl backup verify <FILE>',
    risk: 'safe',
  },
  {
    group: 'hsctl',
    category: 'backup',
    name: 'restore',
    command: 'hsctl restore <FILE> [--yes]',
    description:
      'بازیابی کامل از فایل پشتیبان — مسیر نجات روز حادثه؛ همهٔ داده‌ها (کاربران، دستگاه‌ها، کلیدها) برمی‌گردند.',
    example: 'sudo hsctl restore /var/backups/hem/hem-backup-XXXX.tar.gz',
    risk: 'risky',
  },
  {
    group: 'hsctl',
    category: 'install',
    name: 'update',
    command: 'hsctl update [--check] [--version X.Y.Z] [--yes]',
    description:
      'به‌روزرسانی امن Headscale — نسخه‌به‌نسخه بدون پرش minor؛ خودش پشتیبان می‌گیرد و چک می‌کند.',
    flags: [
      '--check — فقط بررسی نسخهٔ جدید بدون نصب',
      '--version X.Y.Z — هدف‌گیری نسخهٔ مشخص',
    ],
    example: 'hsctl update --check',
    risk: 'risky',
    note: 'ارتقا نسخه‌به‌نسخه است: 0.27 → 0.28 → 0.29 — پرش چندنسخه‌ای ممنوع.',
  },
  {
    group: 'hsctl',
    category: 'config',
    name: 'config',
    command: 'hsctl config show | config path | config validate',
    description:
      'نمایش پیکربندی مؤثر، مسیر فایل پیکربندی و اعتبارسنجی آن — بعد از هر ویرایش دستی، قبل از ری‌استارت.',
    example: 'hsctl config validate',
    risk: 'safe',
  },
  {
    group: 'hsctl',
    category: 'cameras',
    name: 'cameras',
    command:
      'hsctl cameras list | cameras add | cameras remove <name> | cameras check [--name <name>] [--from-client]',
    description:
      'ثبت و مدیریت دستگاه ضبط (NVR) و تست سه‌لایهٔ اتصال: مسیر / ساب‌نت‌روتر / پورت‌ها. بدون رمز و بدون حدس زدن پورت.',
    flags: [
      'add — پرسش‌های مرحله‌ای (نام، برند، IP، پورت‌های اختیاری)',
      'check --name — بررسی یک دستگاه مشخص',
      'check --from-client — بررسی از دید یک کلاینت داخل تونل',
    ],
    example: 'sudo hsctl cameras check --name nvr-daftar',
    risk: 'risky',
  },
  {
    group: 'hsctl',
    category: 'learn',
    name: 'learn',
    command: 'hsctl learn [list | <شماره فصل>]',
    description:
      'مرکز آموزش فارسی داخل ترمینال — فهرست ۱۵ فصل یا نمایش مستقیم یک فصل.',
    example: 'hsctl learn 6',
    risk: 'safe',
  },
  {
    group: 'hsctl',
    category: 'learn',
    name: 'explain',
    command: 'hsctl explain <topic>',
    description:
      'توضیح کوتاه یک مفهوم — موضوعات: vpn, headscale, dns, routes, subnet-router, exit-node, firewall, tls, derper, magicdns, preauthkey, backup.',
    example: 'hsctl explain subnet-router',
    risk: 'safe',
  },
  {
    group: 'hsctl',
    category: 'status',
    name: 'report',
    command: 'hsctl report [--output FILE]',
    description:
      'گزارش قابل‌ارسال برای پشتیبانی — لایهٔ محوسازی خودکار، اطلاعات حساس (رمز/کلید/توکن) را حذف می‌کند.',
    risk: 'safe',
  },
  {
    group: 'hsctl',
    category: 'install',
    name: 'uninstall',
    command: 'hsctl uninstall [--purge-data] [--yes]',
    description:
      'حذف نصب — فقط کارهایی که خود ابزار انجام داده برمی‌گردد؛ پشتیبان‌ها حفظ می‌شوند. با --purge-data داده‌های شبکه هم پاک می‌شوند.',
    risk: 'dangerous',
  },

  // ─── headscale (از FACTS §4) ────────────────────────────────────────
  {
    group: 'headscale',
    category: 'users',
    name: 'users list',
    command: 'headscale users list',
    description:
      'فهرست کاربران با شناسهٔ عددی — جدول: ID | Name | Username | Email | Created.',
    example: 'sudo headscale users list',
    risk: 'safe',
  },
  {
    group: 'headscale',
    category: 'users',
    name: 'users create',
    command: 'headscale users create <NAME>',
    description: 'ساخت کاربر جدید روی سرور (معادل hsctl users create).',
    example: 'sudo headscale users create admin',
    risk: 'risky',
  },
  {
    group: 'headscale',
    category: 'users',
    name: 'nodes list',
    command: 'headscale nodes list [--user <NAME>]',
    description:
      'فهرست دستگاه‌ها با ستون‌های کامل: ID | Hostname | Name | User | IPs | Last seen | Connected و…',
    example: 'sudo headscale nodes list',
    risk: 'safe',
  },
  {
    group: 'headscale',
    category: 'routes',
    name: 'nodes list-routes',
    command: 'headscale nodes list-routes',
    description:
      'نمایش مسیرهای پیشنهادی دستگاه‌ها — ستون‌ها: ID | Hostname | Approved | Available | Serving (Primary). در ۰.۲۹ دستور سطح‌بالای routes فقط alias همین است.',
    example: 'sudo headscale nodes list-routes',
    risk: 'safe',
  },
  {
    group: 'headscale',
    category: 'routes',
    name: 'nodes approve-routes',
    command:
      'headscale nodes approve-routes --identifier <ID> --routes 10.0.0.0/8,192.168.0.0/24',
    description:
      'تأیید مسیرهای یک دستگاه با شناسهٔ عددی نود — رشتهٔ خالی یعنی حذف همهٔ تأییدها. این تنها راه رسمی تأیید/لغو Route در ۰.۲۹ است.',
    example: 'sudo headscale nodes approve-routes --identifier 1 --routes 192.168.1.0/24',
    risk: 'risky',
    note: 'تأیید مسیر فقط با ID عددی نود کار می‌کند (نه نام دستگاه).',
  },
  {
    group: 'headscale',
    category: 'users',
    name: 'auth register / approve',
    command:
      'headscale auth register --user <USER> --auth-id <AUTH_ID>\nheadscale auth approve --auth-id <AUTH_ID>',
    description:
      'جریان احراز هویت تعاملی (Web Auth): کلاینت با tailscale up یک Auth ID می‌گیرد و روی سرور با این دستور ثبت/تأیید می‌شود.',
    example: 'sudo headscale auth register --user admin --auth-id <AUTH_ID>',
    risk: 'risky',
  },
  {
    group: 'headscale',
    category: 'users',
    name: 'preauthkeys create',
    command:
      'headscale preauthkeys create --user <USER_ID> [--reusable] [--ephemeral] [--expiration 30m] [--tags tag:x]',
    description:
      'ساخت کلید از پیش تأییدشده با موتور خام headscale. انقضای پیش‌فرض: ۱ ساعت.',
    example: 'sudo headscale preauthkeys create --user 1 --reusable --expiration 24h',
    risk: 'risky',
    note: '⚠ در preauthkeys، مقدار --user شناسهٔ عددی کاربر است نه نام او — اول با users list بگیریدش.',
  },
  {
    group: 'headscale',
    category: 'backup',
    name: 'preauthkeys expire',
    command: 'headscale preauthkeys expire --id <ID>',
    description:
      'منقضی‌کردن فوری یک کلید اتصال — برای زمانی که کلیدی لو رفته یا دستگاهی گم شده است.',
    example: 'sudo headscale preauthkeys expire --id 5',
    risk: 'risky',
  },
  {
    group: 'headscale',
    category: 'config',
    name: 'health / configtest',
    command: 'headscale health\nheadscale configtest',
    description:
      'بررسی سلامت موتور و اعتبارسنجی فایل پیکربندی — خروجی configtest قبل از ری‌استارت سرویس باید تمیز باشد.',
    example: 'sudo headscale configtest',
    risk: 'safe',
  },

  // ─── tailscale (از FACTS §5) ────────────────────────────────────────
  {
    group: 'tailscale',
    category: 'install',
    name: 'نصب کلاینت',
    command: "curl -fsSL https://tailscale.com/install.sh | sh",
    description:
      'نصب رسمی کلاینت Tailscale روی Ubuntu/Debian — اسکریپت رسمی tailscale.com.',
    example: 'curl -fsSL https://tailscale.com/install.sh | sh',
    risk: 'safe',
  },
  {
    group: 'tailscale',
    category: 'install',
    name: 'up (اتصال به سرور)',
    command:
      'sudo tailscale up --login-server https://headscale.example.com [--authkey <PREAUTHKEY>]',
    description:
      'اتصال کلاینت به سرور شما. بدون --authkey مرورگر باز می‌شود و Auth ID می‌گیرد؛ با --authkey اتصال غیرتعاملی کامل می‌شود.',
    example: 'sudo tailscale up --login-server https://headscale.example.com --authkey <AUTH_KEY>',
    risk: 'risky',
  },
  {
    group: 'tailscale',
    category: 'routes',
    name: 'advertise-routes (ساب‌نت‌روتر)',
    command:
      'sudo tailscale up --advertise-routes=192.168.1.0/24\nsudo tailscale set --advertise-routes=192.168.1.0/24',
    description:
      'اعلام رنج شبکهٔ دفتر از دستگاه داخل دفتر (Subnet Router) — set برای دستگاهی که قبلاً ثبت شده. IP Forwarding هم لازم است (فصل ۶).',
    example: 'sudo tailscale set --advertise-routes=192.168.1.0/24',
    risk: 'risky',
  },
  {
    group: 'tailscale',
    category: 'routes',
    name: 'accept-routes',
    command: 'sudo tailscale set --accept-routes',
    description:
      'پذیرش مسیرها روی کلاینت‌ها — در لینوکس لازم است؛ ویندوز/macOS/اندروید به‌صورت پیش‌فرض می‌پذیرند.',
    example: 'sudo tailscale set --accept-routes',
    risk: 'safe',
  },
  {
    group: 'tailscale',
    category: 'routes',
    name: 'exit-node',
    command:
      'sudo tailscale set --advertise-exit-node   # سمت ارائه‌دهنده\nsudo tailscale set --exit-node <NAME>          # سمت مصرف‌کننده',
    description:
      'تبدیل یک دستگاه به Exit Node (خروجی اینترنت) و انتخاب آن روی کلاینت مصرف‌کننده. تأیید 0.0.0.0/0 روی سرور کافی است (::/0 خودکار می‌آید). پیش‌فرض خاموش و برای این پروژه غیرلازم است (فصل ۷).',
    example: 'sudo tailscale set --exit-node office-router',
    risk: 'risky',
  },
  {
    group: 'tailscale',
    category: 'status',
    name: 'status / ping',
    command: 'tailscale status\ntailscale ip -4\ntailscale ping <peer-ip-or-name>',
    description:
      'وضعیت اتصال کلاینت، IP تونل (رنج 100.64.0.0/10) و تست دیدبان بین دو دستگاه — سه‌گانهٔ همیشگی تست سلامت تونل.',
    example: 'tailscale ping laptop-reza',
    risk: 'safe',
  },
]

/** نکته‌های طلایی — از FACTS و مستندات */
export const CLI_GOLDEN_NOTES: { title: string; body: string }[] = [
  {
    title: 'کلید Preauth فقط یک‌بار نمایش داده می‌شود',
    body: 'خروجی hsctl preauth create کلید را فقط همان لحظه نشان می‌دهد؛ آن را همان‌جا کپی کنید. اگر کلید لو رفت، فوراً با headscale preauthkeys expire --id <ID> آن را منقضی کنید. انقضای پیش‌فرض موتور فقط ۱ ساعت است.',
  },
  {
    title: 'ارتقا نسخه‌به‌نسخه — بدون پرش',
    body: 'مسیر رسمی ارتقای Headscale نسخه‌به‌نسخه است (0.27 → 0.28 → 0.29). hsctl update خودش این را چک می‌کند و هشدار می‌دهد؛ ترتیب: توقف → پشتیبان → نصب نسخهٔ جدید → به‌روزرسانی پیکربندی → اجرا.',
  },
  {
    title: 'routes approve با شناسهٔ عددی نود',
    body: 'در نسخهٔ ۰.۲۹ تأیید Route فقط از طریق nodes approve-routes --identifier <ID> انجام می‌شود و hsctl routes approve <node-id> هم همین ID عددی را می‌گیرد — نه نام دستگاه را. برای گرفتن ID از hsctl routes list استفاده کنید.',
  },
]
