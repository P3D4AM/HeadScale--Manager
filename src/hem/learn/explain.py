"""موضوع‌های آموزشی (hsctl explain) — خلاصه فارسی + بخش مرتبط فصل + دستورها.

جست‌وجوی موضوع با تطبیق دقیق، پسوند و شباهت (fuzzy) ساده.
"""

from __future__ import annotations

import difflib

from hem.learn import chapters

# کلید = نام موضوع؛ هر مقدار: عنوان، خلاصه، شماره فصل مرتبط، کلیدواژه‌های بخش و دستورها
TOPICS: dict = {
    "vpn": {
        "title_fa": "VPN — شبکه خصوصی مجازی",
        "summary_fa": (
            "VPN اتصالی رمزنگاری‌شده است که دستگاه‌های پراکنده (گوشی، لپ‌تاپ، دفتر) را "
            "مثل یک شبکه محلی به هم می‌رساند. راه‌حل‌های مدرن مثل WireGuard/Tailscale "
            "به‌جای مسیریابی همه ترافیک از یک سرور، اتصال مستقیم و سریع می‌سازند."
        ),
        "chapter_order": 1,
        "section_keywords": ["vpn", "شبکه خصوصی"],
        "commands": ["tailscale status", "hsctl status"],
    },
    "headscale": {
        "title_fa": "Headscale — سرور هماهنگ‌سازی متن‌باز",
        "summary_fa": (
            "Headscale پیاده‌سازی متن‌بازِ سرور Tailscale است؛ نقش آن هماهنگ‌سازی (Control Plane) "
            "و تبادل کلیدهاست، در حالی که داده‌ها (Data Plane) بین دستگاه‌ها مستقیم و رمزنگاری‌شده "
            "جابه‌جا می‌شوند. این سرور فقط برای کنترل لازم است، نه برای عبور همه ترافیک."
        ),
        "chapter_order": 2,
        "section_keywords": ["headscale", "کنترل", "control"],
        "commands": ["hsctl status", "headscale health", "hsctl doctor"],
    },
    "dns": {
        "title_fa": "DNS — سلسله‌نظام نام دامنه",
        "summary_fa": (
            "DNS نام دامنه را به IP ترجمه می‌کند. برای این پروژه، رکورد A دامنه شما باید به IP "
            "عمومی سرور اشاره کند تا گواهی HTTPS صادر شود و کلاینت‌ها بتوانند وصل شوند."
        ),
        "chapter_order": 3,
        "section_keywords": ["dns", "رکورد"],
        "commands": ["hsctl doctor", "dig +short example.com"],
    },
    "routes": {
        "title_fa": "Routes — مسیرهای شبکه",
        "summary_fa": (
            "Route یعنی اعلام یک رنج شبکه (مثلاً 192.168.1.0/24) به شبکه VPN. دستگاهی که رنج را "
            "advertise می‌کند باید روی سرور «تأیید» (approve) شود تا بقیه کلاینت‌ها بتوانند از "
            "مسیر آن استفاده کنند."
        ),
        "chapter_order": 6,
        "section_keywords": ["route", "مسیر", "advertise"],
        "commands": [
            "hsctl routes list",
            "hsctl routes approve <شناسه> --routes 192.168.1.0/24",
            "tailscale set --accept-routes",
        ],
    },
    "subnet-router": {
        "title_fa": "Subnet Router — دسترسی به کل شبکه دفتر",
        "summary_fa": (
            "یک دستگاه همیشه‌روشن در دفتر، رنج شبکه دفتر را advertise می‌کند و تبدیل به دروازه "
            "می‌شود؛ این‌طوری از هر جای دنیا می‌توان به CRM/NVR همان شبکه دسترسی داشت. "
            "روی دستگاه دفتر IP Forwarding باید فعال باشد و روی سرور Route تأیید شود."
        ),
        "chapter_order": 6,
        "section_keywords": ["subnet", "ساب‌روتر", "advertise-routes"],
        "commands": [
            "sudo tailscale up --login-server <آدرس> --advertise-routes=192.168.1.0/24",
            "hsctl routes approve <شناسه> --routes 192.168.1.0/24",
            "sudo tailscale set --accept-routes",
        ],
    },
    "exit-node": {
        "title_fa": "Exit Node — عبور اینترنت از سرور",
        "summary_fa": (
            "Exit Node یعنی کل ترافیک اینترنتِ یک کلاینت از یک دستگاه مشخص (مثلاً VPS) عبور کند؛ "
            "مثل VPN سنتی. برای فعال‌سازی، دستگاه exit را advertise کرده، رنج 0.0.0.0/0 را روی "
            "سرور تأیید و در کلاینت انتخابش کنید."
        ),
        "chapter_order": 7,
        "section_keywords": ["exit", "خروج", "0.0.0.0/0"],
        "commands": [
            "sudo tailscale up --login-server <آدرس> --advertise-exit-node",
            "hsctl routes approve <شناسه> --routes 0.0.0.0/0",
            "sudo tailscale set --exit-node <نام>",
        ],
    },
    "firewall": {
        "title_fa": "Firewall — دیوار آتش (UFW)",
        "summary_fa": (
            "فایروال پورت‌های باز سرور را محدود می‌کند. این ابزار UFW را فقط با قواعد حداقلی "
            "تنظیم می‌کند و «اول» پورت SSH را مجاز می‌کند تا دسترسی شما قطع نشود."
        ),
        "chapter_order": 10,
        "section_keywords": ["ufw", "فایروال", "firewall"],
        "commands": ["sudo ufw status verbose", "sudo ufw allow 443/tcp"],
    },
    "tls": {
        "title_fa": "TLS و گواهی HTTPS",
        "summary_fa": (
            "گواهی TLS اتصال کلاینت به سرور را رمزنگاری‌شده و معتبر می‌کند. با Caddy این گواهی "
            "به‌صورت خودکار از Let's Encrypt صادر و تمدید می‌شود؛ فقط DNS درست و پورت‌های 80/443 "
            "باز لازم است."
        ),
        "chapter_order": 4,
        "section_keywords": ["tls", "گواهی", "https", "let's encrypt"],
        "commands": [
            "sudo caddy validate --config /etc/caddy/Caddyfile",
            "sudo systemctl reload caddy",
        ],
    },
    "derper": {
        "title_fa": "DERP — سرور رله (Relay)",
        "summary_fa": (
            "وقتی اتصال مستقیم دو دستگاه ممکن نیست (NAT سخت)، ترافیک از یک رله (DERP) عبور "
            "می‌کند. می‌توانید سرور رله را روی همین VPS فعال کنید (DERP تعبیه‌شده) تا کیفیت بهتر "
            "شود؛ پورت 3478/udp لازم دارد و فقط با HTTPS کار می‌کند."
        ),
        "chapter_order": 2,
        "section_keywords": ["derp", "رله", "relay", "stun"],
        "commands": ["tailscale netcheck", "hsctl doctor"],
    },
    "magicdns": {
        "title_fa": "MagicDNS — نام‌گذاری خودکار دستگاه‌ها",
        "summary_fa": (
            "MagicDNS به هر دستگاه یک نام دامنه می‌دهد (مثلاً laptop.ts.example.com) تا به‌جای "
            "به‌خاطرسپاری IPها با نام به هم دسترسی داشته باشند. دامنه آن باید با دامنه سرور "
            "متفاوت باشد."
        ),
        "chapter_order": 3,
        "section_keywords": ["magicdns", "مجیک", "base_domain"],
        "commands": ["tailscale ping <نام-دستگاه>", "hsctl config show"],
    },
    "preauthkey": {
        "title_fa": "Preauth Key — کلید اتصال بدون مرورگر",
        "summary_fa": (
            "با کلید از پیش تأییدشده می‌توان دستگاه را بدون بازکردن مرورگر به شبکه افزود. "
            "کلیدها تاریخ انقضا دارند و فقط یک‌بار هنگام ساخت نمایش داده می‌شوند."
        ),
        "chapter_order": 5,
        "section_keywords": ["preauth", "کلید", "authkey"],
        "commands": [
            "hsctl preauth create <کاربر> --expiration 1h",
            "sudo tailscale up --login-server <آدرس> --authkey <کلید>",
        ],
    },
    "backup": {
        "title_fa": "پشتیبان‌گیری و بازیابی",
        "summary_fa": (
            "پشتیبان کامل شامل پایگاه‌داده (با snapshot امن SQLite)، کلیدها، پیکربندی و state "
            "ابزار است. برای انتقال به سرور جدید، روی سرور جدید نصب کنید و پشتیبان را بازیابی کنید."
        ),
        "chapter_order": 10,
        "section_keywords": ["پشتیبان", "backup", "restore"],
        "commands": ["hsctl backup create", "hsctl backup list", "hsctl backup verify <فایل>"],
    },
}


def _find_topic(topic: str) -> str | None:
    """یافتن موضوع با تطبیق دقیق → پیشوند → شباهت."""
    topic = (topic or "").strip().lower()
    if not topic:
        return None
    if topic in TOPICS:
        return topic
    for key in TOPICS:
        if key.startswith(topic):
            return key
    close = difflib.get_close_matches(topic, TOPICS.keys(), n=1, cutoff=0.6)
    return close[0] if close else None


def _related_section(chapter_order: int, keywords: list) -> str:
    """جست‌وجوی بخش مرتبط (heading) در متن فصل — نبود یعنی رشته خالی."""
    body = chapters.read_chapter(chapter_order)
    if not body:
        return ""
    lines = body.splitlines()
    start = None
    for idx, line in enumerate(lines):
        if line.startswith("#"):
            heading = line.lower()
            if any(kw.lower() in heading for kw in keywords):
                start = idx
                break
    if start is None:
        return ""
    # بخش تا heading هم‌سطح بعدی
    level = lines[start].count("#")
    collected = [lines[start]]
    for line in lines[start + 1:]:
        if line.startswith("#") and line.count("#") <= level:
            break
        collected.append(line)
    text = "\n".join(collected).strip()
    return text


def explain(topic: str) -> bool:
    """چاپ توضیح فارسی موضوع — False یعنی موضوع شناخته نشد."""
    from hem.i18n import fmt

    key = _find_topic(topic)
    if key is None:
        available = "، ".join(sorted(TOPICS))
        print(fmt("topic_not_found", topic=topic, topics=available))
        return False

    info = TOPICS[key]
    print("═" * 62)
    print(f"  {info['title_fa']}")
    print("═" * 62)
    print(info["summary_fa"])
    print()
    chapter = next((c for c in chapters.list_chapters() if c.number == info["chapter_order"]), None)
    if chapter:
        print(f"📖 فصل مرتبط: {chapter.title}  (hsctl learn {chapter.number})")
        section = _related_section(info["chapter_order"], info["section_keywords"])
        if section:
            print("─" * 62)
            print(section)
        else:
            print("  (متن کامل این بخش هنوز در حال نگارش است؛ کل فصل را ببینید.)")
    else:
        print("📖 فصل مرتبط پیدا نشد (مستندات کامل کپی نشده است).")
    print("─" * 62)
    print("🔧 دستورهای مرتبط:")
    for cmd in info["commands"]:
        print(f"   $ {cmd}")
    return True
