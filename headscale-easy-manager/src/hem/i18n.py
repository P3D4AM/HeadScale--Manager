"""پیام‌های فارسی پروژه — کلیدهای انگلیسی → مقادیر فارسی روان.

استفاده:  from hem.i18n import fmt ;  fmt("need_root_hint", command="status")
"""

MSG: dict[str, str] = {
    # ─── عمومی ───
    "app_title": "مدیر آسان هداسکیل (Headscale Easy Manager)",
    "app_short": "hsctl — مدیر آسان هداسکیل",
    "cancelled": "عملیات لغو شد.",
    "install_cancelled": "نصب لغو شد.",
    "need_root": "این دستور به دسترسی مدیر سیستم (root) نیاز دارد.",
    "need_root_hint": (
        "این دستور باید با دسترسی مدیر اجرا شود:\n"
        "    sudo hsctl {command} …\n"
        "(دستورهای آموزشی «learn»، «explain» و «report» بدون sudo هم کار می‌کنند.)"
    ),
    "invalid_input": "ورودی نامعتبر است.",
    "invalid_retries": "پس از {times} تلاش هنوز مقدار معتبری وارد نشد؛ عملیات لغو شد.",
    "invalid_choice": "گزینه نامعتبر — شماره (یا کلید) یکی از گزینه‌ها را وارد کنید.",
    "non_interactive_error": (
        "این کار در حالت غیرتعاملی (non-interactive) ممکن نیست. "
        "پاسخ‌ها را در فایل پیکربندی YAML بدهید و با «--config FILE --non-interactive» اجرا کنید. "
        "نمونه فایل: examples/hem-install.conf.example"
    ),
    "need_explicit_yes": (
        "در حالت غیرتعاملی، اجرای برنامهٔ تغییرات نیازمند --yes صریح است "
        "(وجود فایل پیکربندی رضایت ضمنی نیست)."
    ),
    "command_failed": "اجرای دستور «{command}» ناموفق بود (کد خروج {code}).",
    "command_missing": "برنامه «{name}» روی سیستم یافت نشد.",
    "command_timeout": "مهلت {timeout} ثانیه‌ای اجرای دستور «{command}» به پایان رسید.",
    "dry_run_notice": "حالت آزمایشی (dry-run): هیچ تغییری واقعاً اعمال نمی‌شود.",
    "not_installed": "نصب نیست.",
    "not_found": "یافت نشد.",
    "yes": "بله",
    "no": "خیر",
    "active": "فعال",
    "inactive": "غیرفعال",
    "unknown": "نامشخص",
    "select_number": "انتخاب شما (شماره): ",
    "confirm_exit": "برای لغو، Ctrl+C را بزنید.",
    # ─── اعتبارسنجی ───
    "invalid_domain": "دامنه باید یک FQDN معتبر باشد؛ مثال: headscale.example.com",
    "invalid_domain_value": "مقدار دامنه معتبر نیست: {value}",
    "invalid_ip": "آدرس IP معتبر نیست.",
    "invalid_port": "پورت باید عددی بین ۱ تا ۶۵۵۳۵ باشد.",
    "invalid_email": "ایمیل واردشده معتبر نیست.",
    "invalid_cidr": "مقدار «{value}» یک CIDR معتبر نیست؛ نمونه درست: 192.168.1.0/24",
    "magic_dns_required": "دامنه MagicDNS (کلید dns.base_domain) الزامی است.",
    "magic_dns_conflict": (
        "دامنه MagicDNS باید با دامنه سرور متفاوت باشد "
        "(مثلاً ts.example.com در برابر headscale.example.com) — قید رسمی Headscale."
    ),
    "derp_needs_https": (
        "سرور DERP تعبیه‌شده تنها در حالت HTTPS کار می‌کند؛ "
        "یا پروکسی Caddy (HTTPS) را فعال کنید یا DERP تعبیه‌شده را خاموش کنید."
    ),
    "invalid_caddy_mode": "حالت caddy باید یکی از install/reuse/skip باشد؛ مقدار دریافتی: {value}",
    "nameserver_invalid": "سرور DNS نامعتبر است: {value}",
    # ─── DNS ───
    "dns_ok": "رکورد A دامنه {domain} به این سرور ({ip}) اشاره می‌کند — عالی!",
    "dns_no_record": (
        "هیچ رکورد A/AAAA برای {domain} پیدا نشد. "
        "در پنل مدیریت DNS دامنه، یک رکورد A با مقدار IP عمومی این سرور ({ips}) بسازید."
    ),
    "dns_mismatch": (
        "رکورد A دامنه {domain} به {found} اشاره می‌کند، اما IP این سرور {expected} است. "
        "رکورد A را به IP سرور به‌روزرسانی کنید."
    ),
    # ─── فایل/پشتیبان ───
    "file_backed_up": "از فایل موجود نسخه پشتیبان گرفته شد: {src} → {dst}",
    "backup_created": "پشتیبان ساخته شد: {path} ({size})",
    "backup_missing": "فایل پشتیبان وجود ندارد: {path}",
    "backup_not_tar": "این فایل یک آرشیو tar.gz معتبر نیست.",
    "backup_checksum_bad": "چک‌سام فایل پشتیبان با فایل sha256 کناری آن نمی‌خواند (احتمال خرابی فایل).",
    "backup_sidecar_missing": "فایل sha256 کناریِ پشتیبان پیدا نشد (برای اطمینان باید وجود داشته باشد).",
    "backup_manifest_bad": "فایل manifest.json داخل پشتیبان قابل خواندن نیست.",
    "backup_manifest_key_missing": "در manifest پشتیبان کلید «{key}» وجود ندارد.",
    "backup_verify_ok": "پشتیبان معتبر است: آرشیو، چک‌سام و manifest همگی سالم‌اند.",
    "backup_file_hash_mismatch": (
        "محتوای «{path}» داخل آرشیو با SHA-256 ثبت‌شده در manifest نمی‌خواند."
    ),
    "backup_file_missing_in_archive": "«{path}» در manifest ثبت شده ولی در آرشیو پیدا نشد.",
    "backup_file_extra_in_archive": "«{path}» داخل آرشیو هست ولی در manifest ثبت نشده.",
    "backup_dangerous_member": (
        "مسیر خطرناک در آرشیو: «{path}» ({reason}) — مسیر مطلق، .. یا پیوند نمادین/سخت."
    ),
    "backup_extra_top": (
        "مدخل غیرمنتظره در ریشهٔ آرشیو: «{name}» (مجاز: etc، var، caddy-block.txt، manifest.json)."
    ),
    "backup_more_issues": "… و {count} ایراد دیگر (برای جلوگیری از سیل خروجی نمایش داده نشد).",
    "checksum_mismatch": (
        "راستی‌آزمایی SHA-256 فایل دانلودشده ناموفق بود ({path}). "
        "اتصال اینترنت را بررسی کنید و دوباره تلاش کنید."
    ),
    "checksum_unknown": "checksum برای این نسخه/معماری در دسترس نیست؛ ادامه بدون راستی‌آزمایی توصیه نمی‌شود.",
    "checksum_mandatory": (
        "راستی‌آزمایی SHA-256 بستهٔ headscale یک الزام امنیتی است و در هیچ حالتی "
        "(تعاملی، غیرتعاملی، dry-run، نصب یا ارتقا) قابل عبور نیست."
    ),
    "checksum_unresolvable": (
        "SHA-256 رسمی برای بستهٔ headscale نسخه {version} معماری {arch} به‌دست نیامد "
        "(نه در جدول پین‌شده و نه از checksums.txt رسمی همان انتشار). "
        "عملیات متوقف شد — این یک الزام امنیتی است و مسیر عبوری وجود ندارد. "
        "اتصال اینترنت را بررسی کنید یا نسخهٔ پین‌شده {pinned} را نصب کنید."
    ),
    "checksum_missing_expected": (
        "ادامهٔ دانلود بدون SHA-256 مورد انتظار مجاز نیست (الزام امنیتی) — "
        "خودِ فایل دانلودی هرگز منبع checksum خودش نیست."
    ),
    "confirm_restore": (
        "بازیابی، وضعیت فعلی headscale را با محتوای پشتیبان جایگزین می‌کند. "
        "ابتدا از وضعیت فعلی پشتیبان ایمن گرفته می‌شود. ادامه می‌دهید؟"
    ),
    "db_locked_stop_service": (
        "پایگاه‌دادۀ SQLite قفل است (سرویس در حال نوشتن). "
        "برای snapshot مطمئن، سرویس headscale چند ثانیه متوقف شود؟"
    ),
    # ─── سرویس/سیستم ───
    "service_not_active": "سرویس «{unit}» فعال نیست.",
    "headscale_not_installed": "headscale روی این سیستم نصب نیست.",
    "preflight_failed": "بررسی پیش‌نیازها ناموفق بود؛ ابتدا موارد قرمز (fail) را رفع کنید.",
    "ssh_port_unknown": (
        "پورت SSH فعلی قابل تشخیص نبود؛ برای فعال‌سازی فایروال، ابتدا پورت SSH را مشخص کنید "
        "(در فایل پیکربندی نصب کلید ssh_port را مقداردهی کنید)."
    ),
    "other_firewall_active": (
        "فایروال دیگری (nftables/iptables) با قواعد فعال شناسایی شد؛ "
        "برای امنیت، hsctl به آن دست نمی‌زند. قواعد 80/tcp، 443/tcp و در صورت نیاز 3478/udp را خودتان باز کنید."
    ),
    "ufw_install_failed": "نصب بسته ufw ناموفق بود.",
    "ufw_allow_failed": "افزودن قاعده ufw برای {port} ناموفق بود: {error}",
    "ufw_enable_failed": (
        "فعال‌سازی ufw ناموفق بود — نصب به‌عنوان موفق گزارش نمی‌شود. "
        "وضعیت را ببینید: ufw status"
    ),
    "firewall_snapshot_saved": "تصویر وضعیت فایروال و پورت‌ها ذخیره شد: {path}",
    "firewall_snapshot_state_only": (
        "ذخیرهٔ فایل تصویر وضعیت فایروال ممکن نشد (دسترسی نوشتن نداریم) — "
        "فقط در state ابزار ثبت شد."
    ),
    "firewall_risky_listener": (
        "سرویس «{process}» روی پورت {port} (اتصال {bind}) از بیرون قابل دسترسی است — "
        "با فعال‌شدن UFW از بیرون قطع خواهد شد."
    ),
    "firewall_consent_title": "سرویس‌های زیر با فعال‌شدن UFW از بیرون دسترسی نخواهند داشت:",
    "firewall_consent_noninteractive": (
        "فعال‌سازی فایروال متوقف شد — این سرویس‌ها از بیرون در دسترس‌اند و "
        "فعال‌کردن UFW بدون قاعدهٔ allow مناسب، آن‌ها را قطع می‌کند. "
        "ابتدا برایشان قاعده تعریف کنید (ufw allow) یا در حالت تعاملی اجرا کنید:"
    ),
    "firewall_consent_cancelled": (
        "فعال‌سازی فایروال با انتخاب شما لغو شد؛ هیچ قاعده‌ای اضافه و فعالی‌سازی‌ای "
        "انجام نشد."
    ),
    "firewall_rollback_note": (
        "بازگشت فایروال: {removed} قاعدهٔ خودمان حذف شد"
        "{extra}"
    ),
    # ─── CLI ───
    "user_not_found": "کاربر «{name}» پیدا نشد. فهرست کاربران: hsctl users list",
    "node_not_found": "دستگاهی با شناسه {id} پیدا نشد. فهرست دستگاه‌ها: hsctl devices list",
    "key_shown_once": (
        "⚠ امنیت: این کلید فقط همین یک‌بار نمایش داده می‌شود؛ "
        "آن را در جای امن نگه دارید و هرگز در گزارش، لاگ یا پیام‌ها کپی نکنید."
    ),
    "confirm_delete_user": "کاربر «{name}» (شناسه {id}) همراه همه دستگاه‌هایش حذف شود؟",
    "confirm_delete_device": "دستگاه «{name}» (شناسه {id}) حذف شود؟",
    "confirm_revoke_routes": "همه Routeهای تأییدشده دستگاه {id} لغو شود؟",
    "update_version_jump": (
        "ارتقا از {current} به {target} یک پرش نسخه است. "
        "طبق قید رسمی Headscale ارتقا باید نسخه‌به‌نسخه (بدون پرش minor) انجام شود؛ "
        "خطر ناسازگاری پایگاه‌دادۀ وجود دارد. ادامه می‌دهید؟"
    ),
    "update_downgrade": "نسخه هدف ({target}) قدیمی‌تر از نسخه فعلی ({current}) است — این یک پایین‌آوردن نسخه (downgrade) است. ادامه می‌دهید؟",
    "update_failed_title": "به‌روزرسانی ناموفق بود",
    "update_rollback_started": "اجرای بازگشت به نسخهٔ قبلی (rollback واقعی):",
    "update_rollback_ok": "بازگشت به نسخهٔ قبلی ({version}) کامل شد و سرویس سالم است.",
    "update_rollback_failed": "بازگشت به نسخهٔ قبلی هم ناموفق بود!",
    "update_rollback_not_prepared": (
        "بستهٔ نسخهٔ قبلی از قبل آماده نشده بود — بازگشت خودکار ممکن نیست. "
        "خوشبختانه هنوز هیچ تغییری روی سرویس/بسته اعمال نشده بود."
    ),
    "camera_not_found": "دوربینی با نام «{name}» ثبت نشده است.",
    "docs_not_found": (
        "پوشه مستندات فارسی (docs/fa) پیدا نشد. "
        "پروژه را کامل کپی کنید یا از مسیر نصب استاندارد /opt/headscale-easy-manager اجرا کنید."
    ),
    "chapter_not_found": "فصل {n} پیدا نشد. فهرست فصل‌ها: hsctl learn list",
    "topic_not_found": "موضوع «{topic}» شناخته نشد. موضوع‌های موجود: {topics}",
    "report_saved": "گزارش در {path} ذخیره شد.",
    "report_review": (
        "⚠ قبل از ارسال گزارش به دیگران، آن را بازبینی کنید؛ "
        "لایه محوسازی خودکار، جایگزین دقت انسانی نیست."
    ),
    "cameras_empty": "هنوز دوربینی ثبت نشده است. افزودن: hsctl cameras add",
    "confirm_uninstall": "حذف نصب ادامه یابد؟ (فقط کارهای خود ابزار برمی‌گردد)",
    "confirm_purge": "حذف کامل داده‌ها (پایگاه‌داده، کلیدها و پشتیبان‌ها)؟ این کار برگشت‌پذیر نیست!",
    "uninstall_done": "حذف نصب کامل شد. موارد باقی‌مانده (دست‌نخورده):",
    # ─── وضعیت نهایی نصب (اصلاح ۴.۴) ───
    "final_verified": "نصب انجام شد و صحت آن تأیید شد.",
    "final_service_not_ready": "نصب انجام شد اما سرویس آماده نیست.",
    "final_pending_verification": "DNS یا گواهی TLS هنوز آماده نیست.",
    "final_pending_note": (
        "دسترسی از بیرون تأیید نشده است — تا آماده‌شدن DNS/گواهی TLS، "
        "دسترسی‌پذیری بیرونی «تأییدنشده» باقی می‌ماند."
    ),
    "final_partial_failure": "بخشی از عملیات شکست خورده است.",
    "final_full_success": "نصب کاملاً موفق است.",
}


def fmt(key: str, **kwargs) -> str:
    """بازگرداندن پیام فارسیِ کلید داده‌شده؛ در صورت نبودِ کلید، خود کلید برمی‌گردد."""
    text = MSG.get(key, key)
    if kwargs:
        try:
            return text.format(**kwargs)
        except (KeyError, IndexError, ValueError):
            return text
    return text
