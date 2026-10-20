#!/usr/bin/env bash
# ============================================================================
#  Headscale Easy Manager — Bootstrap Installer
#  نصب‌کننده راه‌انداز (Bootstrap). منطق اصلی نصب در ابزار hsctl (پایتون) است.
#  این فایل عمداً کوتاه نگه داشته شده است: فقط آماده‌سازی محیط و اجرای hsctl.
#
#  استفاده:
#     sudo ./install.sh                          # حالت تعاملی
#     sudo ./install.sh --config /path/hem.conf  # حالت خودکار
#     sudo ./install.sh --dry-run                # نمایش بدون اعمال
#
#  کد خروج: 0 موفق | 1 خطا | 2 ورودی نامعتبر
# ============================================================================
set -euo pipefail

PRODUCT_NAME="Headscale Easy Manager"
PRODUCT_DIR_NAME="headscale-easy-manager"
DEFAULT_INSTALL_DIR="/opt/headscale-easy-manager"
CLI_NAME="hsctl"
MIN_DISK_MB=10240          # حداقل ۱۰ گیگابایت فضای آزاد
SUPPORTED_OS_ID="ubuntu"
SUPPORTED_OS_VERSIONS=("22.04" "24.04")
BEST_EFFORT_OS_IDS=("ubuntu" "debian")   # تلاش ادامه با هشدار (بدون ادعای پشتیبانی)

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'

msg()  { printf '%s\n' "${CYAN}[*]${RESET} $*"; }
ok()   { printf '%s\n' "${GREEN}[✓]${RESET} $*"; }
warn() { printf '%s\n' "${YELLOW}[!]${RESET} $*"; }
fail() { printf '%s\n' "${RED}[✗]${RESET} $*" >&2; }

die() { fail "$1"; exit "${2:-1}"; }

# --- پارس آرگومان‌ها -------------------------------------------------------
CONFIG_FILE=""
DRY_RUN=0
INSTALL_DIR="$DEFAULT_INSTALL_DIR"
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --config)         CONFIG_FILE="${2:?--config نیاز به مسیر فایل دارد}"; shift 2 ;;
        --dry-run)        DRY_RUN=1; EXTRA_ARGS+=("--dry-run"); shift ;;
        --non-interactive) EXTRA_ARGS+=("--non-interactive"); shift ;;
        --install-dir)    INSTALL_DIR="${2:?--install-dir نیاز به مسیر دارد}"; shift 2 ;;
        -h|--help)
            sed -n '2,12p' "$0"; exit 0 ;;
        *) EXTRA_ARGS+=("$1"); shift ;;
    esac
done

# --- نمایش خوش‌آمد ----------------------------------------------------------
printf '%s\n' ""
printf '%s\n' "${BOLD}سلام! این برنامه برای راه‌اندازی شبکه خصوصی شما استفاده می‌شود.${RESET}"
printf '%s\n' "محصول: ${BOLD}${PRODUCT_NAME}${RESET} (نصب‌کننده هوشمند Headscale)"
printf '%s\n' "ابتدا بررسی می‌کنم که سرور آماده نصب باشد…"
printf '%s\n' ""

# --- ۱) بررسی root (نصب سرویس سیستمی نیاز به root دارد) --------------------
if [[ ${EUID} -ne 0 ]]; then
    warn "این اسکریپت با root اجرا نشده است. با sudo اجرا کنید:"
    printf '    sudo %s\n' "$0"
    printf '%s\n' "اگر فقط می‌خواهید مستندات را بخوانید، لازم به root نیست:"
    printf '    ./hsctl learn list\n'
    exit 3
fi

# --- ۲) بررسی سیستم‌عامل ----------------------------------------------------
if [[ ! -r /etc/os-release ]]; then
    die "فایل /etc/os-release قابل خواندن نیست؛ سیستم‌عامل قابل تشخیص نیست. این نصب‌کننده برای Ubuntu Server 22.04/24.04 است."
fi
# shellcheck disable=SC1091
. /etc/os-release
OS_ID="${ID:-unknown}"
OS_VERSION="${VERSION_ID:-}"
ARCH="$(uname -m)"

msg "سیستم‌عامل تشخیص داده شد: ${PRETTY_NAME:-$OS_ID $OS_VERSION}"
msg "معماری: ${ARCH}"

if [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]]; then
    die "معماری «${ARCH}» پشتیبانی نمی‌شود. معماری‌های مجاز: amd64 (x86_64) و arm64 (aarch64)."
fi

OS_OK=0
if [[ "$OS_ID" == "$SUPPORTED_OS_ID" ]]; then
    for v in "${SUPPORTED_OS_VERSIONS[@]}"; do
        [[ "$OS_VERSION" == "$v" ]] && OS_OK=1
    done
fi
if [[ $OS_OK -eq 1 ]]; then
    ok "سیستم‌عامل سازگار است (Ubuntu ${OS_VERSION} — پشتیبانی‌شده و آزموده‌شده)."
elif [[ " ${BEST_EFFORT_IDS[*]:-${BEST_EFFORT_OS_IDS[*]}} " == *" $OS_ID "* ]]; then
    warn "سیستم‌عامل «${PRETTY_NAME:-$OS_ID $OS_VERSION}» جزو نسخه‌های رسمی آزموده‌شده نیست."
    warn "نصب ادامه می‌یابد اما سازگاری «آزمایش‌نشده» تلقی می‌شود. (Ubuntu 22.04/24.04 توصیه می‌شود.)"
else
    die "سیستم‌عامل «${OS_ID}» پشتیبانی نمی‌شود. از Ubuntu Server 22.04 یا 24.04 LTS (amd64) استفاده کنید."
fi

# --- ۳) بررسی فضای دیسک -----------------------------------------------------
read -r _ AVAIL_MB _ < <(df -Pm / | awk 'NR==2 {print $2, $4, $5}')
msg "فضای آزاد پارتیشن ریشه: $((AVAIL_MB / 1024)) گیگابایت"
if (( AVAIL_MB < MIN_DISK_MB )); then
    die "فضای آزاد کافی نیست (حداقل ${MIN_DISK_MB} مگابایت لازم است، اکنون ${AVAIL_MB} مگابایت موجود است). فایل‌های غیرلازم را پاک کنید یا دیسک را بزرگ کنید."
fi
ok "فضای دیسک کافی است."

# --- ۴) بررسی/نصب Python و پیش‌نیازها ----------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
    msg "پایتون ۳ یافت نشد؛ در حال نصب python3 و python3-yaml …"
    if [[ $DRY_RUN -eq 1 ]]; then
        warn "[dry-run] از نصب بسته‌ها صرف‌نظر شد: python3 python3-yaml"
    else
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq || die "apt update ناموفق بود؛ اتصال اینترنت سرور را بررسی کنید."
        apt-get install -y -qq python3 python3-yaml \
            || die "نصب python3/python3-yaml ناموفق بود."
    fi
fi

PY_MAJOR="$(python3 -c 'import sys;print(f"{sys.version_info[0]}{sys.version_info[1]}")' 2>/dev/null || echo 0)"
if (( PY_MAJOR < 310 )); then
    die "نسخه پایتون ${PY_MAJOR:0:1}.${PY_MAJOR:1:1} قدیمی است؛ حداقل Python 3.10 لازم است (Ubuntu 22.04+ به‌صورت پیش‌فرض دارد)."
fi
ok "پایتون ۳ آماده است ($(python3 --version))."

if ! python3 -c 'import yaml' >/dev/null 2>&1; then
    if [[ $DRY_RUN -eq 1 ]]; then
        warn "[dry-run] ماژول python3-yaml نصب نیست؛ در اجرای واقعی نصب می‌شود."
    else
        msg "در حال نصب python3-yaml …"
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq && apt-get install -y -qq python3-yaml \
            || die "نصب python3-yaml ناموفق بود (لازم برای خواندن/نوشتن پیکربندی YAML)."
    fi
fi

# --- ۵) کپی پروژه به مسیر نصب ------------------------------------------------
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$SRC_DIR" != "$INSTALL_DIR" ]]; then
    msg "کپی فایل‌های پروژه به ${INSTALL_DIR} …"
    if [[ $DRY_RUN -eq 1 ]]; then
        warn "[dry-run] کپی انجام نشد: ${SRC_DIR} → ${INSTALL_DIR}"
    else
        mkdir -p "$INSTALL_DIR"
        # از rsync/cp فقط برای فایل‌های پروژه؛ پشتیبان‌گیری از نسخه قبلی
        if [[ -d "$INSTALL_DIR/src" ]]; then
            BACKUP_OLD="${INSTALL_DIR}.old-$(date +%Y%m%d%H%M%S)"
            warn "نسخه قبلی ابزار در «${BACKUP_OLD}» نگه داشته می‌شود."
            cp -a "$INSTALL_DIR" "$BACKUP_OLD"
        fi
        cp -a "$SRC_DIR/." "$INSTALL_DIR/"
    fi
fi

# --- ۶) ساخت symlink برای دستور hsctl ----------------------------------------
if [[ $DRY_RUN -eq 0 ]]; then
    chmod +x "${INSTALL_DIR}/hsctl"
    ln -sf "${INSTALL_DIR}/hsctl" "/usr/local/bin/${CLI_NAME}"
    ok "دستور ${CLI_NAME} در مسیر PATH نصب شد: $(command -v "$CLI_NAME" || echo /usr/local/bin/hsctl)"
fi

# --- ۷) اجرای نصب‌کننده اصلی (منطق کامل در پایتون) ----------------------------
printf '%s\n' ""
msg "اجرای نصب‌کننده اصلی (${CLI_NAME} install) …"
printf '%s\n' "────────────────────────────────────────────────────────────"
if [[ $DRY_RUN -eq 1 ]]; then
    # در حالت dry-run منطق اصلی هم dry-run می‌شود
    python3 "${INSTALL_DIR}/hsctl" install --dry-run ${CONFIG_FILE:+--config "$CONFIG_FILE"} "${EXTRA_ARGS[@]}" || true
    printf '%s\n' "────────────────────────────────────────────────────────────"
    warn "[dry-run] هیچ تغییری واقعاً اعمال نشد."
    exit 0
fi

python3 "${INSTALL_DIR}/hsctl" install ${CONFIG_FILE:+--config "$CONFIG_FILE"} "${EXTRA_ARGS[@]}"
RC=$?
printf '%s\n' "────────────────────────────────────────────────────────────"
if [[ $RC -eq 0 ]]; then
    ok "نصب کامل شد! برای شروع: ${CLI_NAME} status   |   آموزش: ${CLI_NAME} learn list"
else
    fail "نصب‌کننده با کد ${RC} متوقف شد. برای عیب‌یابی اجرا کنید: ${CLI_NAME} doctor"
fi
exit $RC
