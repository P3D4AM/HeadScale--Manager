"""ثابت‌های پروژه — همه مقادیر از docs/FACTS.md (بخش‌های ۱، ۲، ۷، ۹ و ۱۰) استخراج شده‌اند.

هیچ مسیر/دستور/کلیدی نباید در جای دیگری «حدس» زده شود؛ این ماژول منبع واحد است.
"""

# --- هویت محصول (FACTS §9) ---
PRODUCT_NAME = "Headscale Easy Manager"
PRODUCT_NAME_FA = "مدیر آسان هداسکیل"
CLI_NAME = "hsctl"

# --- مسیرها (FACTS §9) ---
DEFAULT_INSTALL_DIR = "/opt/headscale-easy-manager"
STATE_DIR = "/etc/hem"
STATE_FILE = "/etc/hem/state.json"
CAMERAS_FILE = "/etc/hem/cameras.yaml"
ANSWERS_FILE = "/etc/hem/install-answers.yaml"
BACKUP_DIR = "/var/backups/hem"
LOG_DIR = "/var/log/hem"
LOG_FILE = "/var/log/hem/hem.log"
FALLBACK_LOG_FILE = "/tmp/hem.log"

# --- مسیرهای استاندارد بسته .deb رسمی headscale (FACTS §2) ---
HEADSCALE_BIN = "/usr/bin/headscale"
HEADSCALE_CONFIG_DIR = "/etc/headscale"
HEADSCALE_CONFIG_PATH = "/etc/headscale/config.yaml"
HEADSCALE_DATA_DIR = "/var/lib/headscale"
HEADSCALE_DB_PATH = "/var/lib/headscale/db.sqlite"
HEADSCALE_USER = "headscale"
HEADSCALE_GROUP = "headscale"
HEADSCALE_UNIT = "headscale.service"

# --- Caddy (FACTS §6) ---
CADDY_UNIT = "caddy.service"
CADDYFILE_PATH = "/etc/caddy/Caddyfile"
CADDY_BLOCK_BEGIN = "# BEGIN headscale-easy-manager"
CADDY_BLOCK_END = "# END headscale-easy-manager"
CADDY_KEYRING_PATH = "/usr/share/keyrings/caddy-stable-archive-keyring.gpg"
CADDY_REPO_LIST_PATH = "/etc/apt/sources.list.d/caddy-stable.list"
CADDY_GPG_KEY_URL = "https://dl.cloudsmith.io/public/caddy/stable/gpg.key"
CADDY_REPO_URL = "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt"

# --- نسخه‌ها و دانلود (FACTS §1) ---
PINNED_HS_VERSION = "0.29.5"
PINNED_HS_SHA256_AMD64 = "9e8ec12a65229435863a2cdf5082853c282808e845efd3a1f0b0c02b8f84d723"
HS_DEB_URL_TEMPLATE = (
    "https://github.com/juanfont/headscale/releases/download/"
    "v{version}/headscale_{version}_linux_{arch}.deb"
)
CHECKSUMS_URL_TEMPLATE = (
    "https://github.com/juanfont/headscale/releases/download/v{version}/checksums.txt"
)
GITHUB_LATEST_API = "https://api.github.com/repos/juanfont/headscale/releases/latest"

# --- پورت‌ها (FACTS §7) ---
PORT_HTTP = 80
PORT_HTTPS = 443
PORT_STUN = 3478
PORT_HS_LISTEN = 8080

# --- پیش‌نیازهای حداقلی (FACTS §9) ---
MIN_DISK_GB = 10
MIN_RAM_MB = 1024
MIN_PYTHON = (3, 10)
SUPPORTED_OS_ID = "ubuntu"
SUPPORTED_OS_VERSIONS = ("22.04", "24.04")
BEST_EFFORT_OS_IDS = ("debian",)

# --- APIهای تشخیص IP عمومی ---
PUBLIC_IP_URLS = ("https://api.ipify.org", "https://api64.ipify.org")
PUBLIC_IP_TIMEOUT = 10

# --- کدهای خروج hsctl (FACTS §10) ---
EXIT_OK = 0
EXIT_ERROR = 1
EXIT_INVALID = 2
EXIT_NEED_ROOT = 3
# کد ۴ — «سرویس/زیرساخت موردنیاز موجود نیست»؛ از نسخهٔ اصلاح ۴.۴ همچنین برای
# وضعیت‌های پایانی نصب: service_not_ready و pending_verification به‌کار می‌رود
# (نصب انجام شده ولی سرویس آماده نیست یا تأیید بیرونی DNS/TLS ناقص است).
EXIT_MISSING = 4
EXIT_NO_CONFIRM = 5

# --- ریسک عملیات ---
RISK_SAFE = "safe"
RISK_RISKY = "risky"
RISK_DESTRUCTIVE = "destructive"
