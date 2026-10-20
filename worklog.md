# Worklog — Headscale Easy Manager

این فایل لاگ مشترک همه عامل‌هاست. هر عامل قبل از شروع کار باید آن را بخواند و پس از پایان، گزارش خود را با قالب مشخص **اضافه** کند (نه بازنویسی).

---
Task ID: 1
Agent: Main Orchestrator (Z.ai Code)
Task: تحقیق فنی (مرحله A) + طراحی اسکلت پروژه (مرحله B)

Work Log:
- محیط توسعه بررسی شد: Next.js 16 + Python 3.12 + PyYAML + git موجود است.
- تحقیق فنی واقعی انجام شد: کلون سطحی مخزن رسمی juanfont/headscale در تگ v0.29.5.
- آخرین نسخه پایدار راستی‌آزمایی شد: v0.29.5 (صفحه releases گیت‌هاب).
- فایل‌های checksums.txt رسمی و digest صفحه انتشار دریافت و تطبیق داده شدند (SHA-256 بسته deb: 9e8ec12a65229435863a2cdf5082853c282808e845efd3a1f0b0c02b8f84d723).
- config-example.yaml رسمی v0.29.5 کامل استخراج و کلیدهای معتبر پیکربندی مستند شد.
- تمام دستورات CLI از سورس cmd/headscale/cli/*.go استخراج شد (تغییر مهم: مدیریت Route با nodes approve-routes، preauthkeys با شناسه عددی کاربر، جریان auth register/approve).
- مستندات رسمی routes/registration/reverse-proxy/requirements/upgrade/clients مطالعه شد.
- واحد سرویس systemd رسمی (packaging/systemd/headscale.service) دریافت شد.
- ساختار پروژه در /home/z/my-project/headscale-easy-manager ساخته شد.
- فایل‌های ایجادشده: docs/architecture-report.md، docs/FACTS.md (قرارداد فنی منبع واحد حقیقت)، install.sh (bootstrap)، hsctl (entry)، pyproject.toml، Makefile، .gitignore، LICENSE، CHANGELOG.md، ۱۴ فایل فصل مستندات با frontmatter قراردادی در docs/fa/، examples/hem-install.conf.example، examples/caddy/Caddyfile.headscale.example.

Stage Summary:
- نسخه هدف: Headscale v0.29.5 — همه حقایق فنی در docs/FACTS.md قفل شده است؛ همه عامل‌های بعدی موظفند فقط از FACTS.md پیروی کنند و هیچ دستور/مسیر/کلید تنظیماتی را حدس نزنند.
- قرارداد رابط CLI در FACTS.md بخش ۱۱، نام فایل فصل‌ها در بخش ۱۲، و کدهای خروج در بخش ۱۰ تعریف شده است.
- مسیرهای ثابت: نصب /opt/headscale-easy-manager، state در /etc/hem/، پشتیبان /var/backups/hem/، لاگ /var/log/hem/hem.log، مارکر Caddy با BEGIN/END headscale-easy-manager.
- گام‌های بعدی: Task 2-a (پایتون)، 2-b (مستندات ۱-۷)، 2-c (مستندات ۸-۱۴) به‌صورت موازی، سپس Task 3 (وب‌اپ).

---
Task ID: 2-b
Agent: Senior Persian Technical Writer (Z.ai Code)
Task: نگارش کامل فصل‌های ۱ تا ۷ مرکز آموزش فارسی «Headscale Easy Manager»

Work Log:
- worklog.md و docs/FACTS.md مطالعه شد؛ تمام دستورات صرفاً از FACTS §4 (CLI headscale)، §5 (کلاینت tailscale)، §11 (قرارداد hsctl) و ثابت‌های §9 گرفته شد.
- برای صحت فنی سه مورد به‌طور مستقل راستی‌آزمایی شد (کلون واقعی headscale v0.29.5 در /tmp/headscale-src): صفحهٔ /health پاسخ {"status":"pass"} می‌دهد (hscontrol/handlers.go)؛ صفحات /apple و /windows روی سرور وجود دارند (hscontrol/app.go: r.Get("/apple"...), r.Get("/windows"...))؛ متن صفحهٔ ثبت دستگاه دقیقاً دستور «headscale auth register --auth-id <id> --user USERNAME» را نشان می‌دهد (RegisterHandler).
- واحد systemd رسمی بررسی شد (Description: "headscale coordination server for Tailscale") و در نمونهٔ خروجی systemctl استفاده شد.
- سورس CLI کلاینت tailscale (cmd/tailscale/cli/set.go از مخزن رسمی) چک شد: --advertise-exit-node از نوع Bool است؛ فرم «--advertise-exit-node=» (خالی) نامعتبر است — از مستندات حذف و به‌جای آن ارجاع به hsctl routes revoke داده شد. فرم «--exit-node=» (String) معتبر است و طبق مأموریت باقی ماند.
- ۷ فایل stub بازنویسی شد؛ frontmatter (title/order/icon) دست‌نخورده، فقط description فصل ۴ و ۶ بهبود یافت. هیچ فایل دیگری تغییری نکرد.
- ساختار هر فصل: «در این فصل یاد می‌گیرید» + بدنه با بلوک‌های bash (توضیح خط‌به‌خط)، نمونهٔ خروجی در text، نمودارهای ASCII، تشبیه با ذکر «مرز تشبیه و واقعیت» + «خلاصه فصل» + لینک نسبی به فصل بعد.
- مقادیر نمونهٔ یکدست: دامنه headscale.example.com، IP سرور 203.0.113.10 (رنج مستندات)، MagicDNS: ts.example.com، شبکهٔ دفتر 192.168.1.0/24، CRM در 192.168.1.220:800، سابت‌روتر office-router (LAN 192.168.1.10 / VPN 100.64.0.1)، کاربر admin. هیچ رمز/کلید واقعی؛ فقط placeholder مثل <AUTH_KEY>، <AUTH_ID>، <REPO_URL>.
- فصل ۴: نصب رسمی فقط sudo ./install.sh؛ روش توزیع با placeholder + تأکید بر مخزن رسمی و بررسی SHA-256 (sha256sum)؛ دیالوگ کامل نصب (دامنه، سه گزینهٔ DNS، ایمیل، Caddy، DERP، MagicDNS، UFW، کاربر اول) منطبق بر install.sh واقعی و examples/hem-install.conf.example؛ جدول ۱۷ گام از preflight تا گزارش منطبق بر جریان docs/architecture-report.md؛ سه تست پس از نصب (systemctl status headscale، https://دامنه/health، hsctl status)؛ ۵ خطای رایج.
- فصل ۵: جدول تمایز آدرس سرور کنترل vs آدرس CRM؛ اندروید (Play/F-Droid + Settings→Accounts→⋮→Use an alternate server / Use an auth key)؛ ویندوز (tailscale login --login-server در PowerShell)؛ لینوکس (install.sh رسمی + tailscale up)؛ macOS/iOS با ارجاع به /apple و /windows روی سرور خود کاربر؛ جریان Web Auth دقیقاً مطابق FACTS §4 + preauth با hsctl (هشدار --user عددی در دستور خام).
- فصل ۶: سناریوی کامل + ۷ گام (نصب/اعلام رنج/sysctl دقیق FACTS §5/تأیید با hsctl routes approve یا nodes approve-routes/accept-routes روی لینوکس با تصریح صادقانهٔ پذیرش پیش‌فرض ویندوز-اندروید-مک/تست/مسیر برگشت با SNAT) + عیب‌یابی ۵ سؤالی + ارجاع به فصل ۹ + تأکید مأموریت.
- فصل ۷: تعریف Exit Node، سناریوهای لازم/غیرلازم، جدول مقایسه با Subnet Router، سه گام فعال‌سازی (تأیید 0.0.0.0/0 کافی است و ::/0 خودکار)، Kill Switch داخلی (Block connections without VPN در اندروید)، بازگشت با --exit-node=، هشدار «پیش‌فرض خاموش و غیرلازم».
- بازخوانی نهایی هر فصل انجام شد: استخراج برنامه‌ریزی‌شدهٔ تمام بلوک‌های bash/powershell و تطبیق تک‌به‌تک با FACTS؛ اصلاح چند تایپو (خط فرام→فرمان، وضعت→وضعیت، گوشي عربی→گوشی فارسی، حذف سابت‌روتر در متن)، دقیق‌سازی چرخهٔ مسیر برگشت فصل ۶ (SNAT) و بخش Kill Switch فصل ۷.

Stage Summary:
- فصل‌های ۱ تا ۷ مرکز آموزش کامل شدند (مجموع ۱۷۶۷ خط markdown)؛ همهٔ دستورات headscale/tailscale/hsctl عیناً از FACTS.md اند و سه مورد کلیدی (/health، /apple، /windows) مستقیماً از سورس v0.29.5 راستی‌آزمایی شد.
- فایل‌ها با تعداد خط: 01-vpn-chist.md (175)، 02-headscale-chist.md (199)، 03-mafahim-shabake.md (215)، 04-nasb-avvalieh.md (376)، 05-ettesal-dastgahha.md (323)، 06-dastresi-shabake-daftar.md (304)، 07-exit-node.md (175).
- قالب‌ها رعایت شد: ۱۵۰-۴۵۰ خط برای هر فصل، لینک نسبی به فصل بعد (فصل ۷ → 08-modiriyat-roozmareh.md، فصل ۶ ارجاع اضافه به 09-eibyabi.md)، placeholder برای همهٔ مقادیر حساس.
- گام‌های بعدی: Task 2-c فصل‌های ۸ تا ۱۴ با همین سبک ادامه دهد (فصل ۸ لینک‌شده از فصل ۷ است و باید مدیریت روزمره، hsctl routes revoke/uninstall، پشتیبان و دوربین‌ها را پوشش دهد).

---
Task ID: 2-c
Agent: Senior Persian Technical Writer (Z.ai Code)
Task: نگارش کامل فصل‌های ۸ تا ۱۴ مرکز آموزش فارسی «Headscale Easy Manager» (+ افزونه دوربین‌های مداربسته Dahua)

Work Log:
- worklog.md، docs/FACTS.md و examples/hem-install.conf.example مطالعه شد؛ تمام دستورات صرفاً از FACTS §4 (CLI headscale)، §5 (کلاینت tailscale)، §6 (Caddy)، §8 (پشتیبان/ارتقا) و §11 (قرارداد hsctl) گرفته شد. هیچ دستوری ساخته/حدس زده نشد.
- ۷ فایل stub بازنویسی شد؛ frontmatter (title/order/icon) دست‌نخورده و فقط descriptionها بهبود یافت. هیچ فایل دیگری تغییر نکرد.
- برای یکدستی با خروجی Task 2-b (فصل‌های ۱-۷): نام ساب‌نت‌روتر نمونه «office-router»، IPهای تونل از 100.64.0.1 (تخصیص ترتیبی)، دامنه headscale.example.com، MagicDNS: ts.example.com، شبکه دفتر 192.168.1.0/24، CRM در 192.168.1.220:800 به‌کار رفت؛ سناریوی داستانی فصل ۱۲ (آقای رضایی، دامنه vpn.rezaee-shop.ir) مجموعه دستگاه‌های خودش را دارد (phone-reza/laptop-reza/server-daftar).
- فصل ۸: مرجع دستور‌به‌دستور hsctl (status/doctor چهاربخشی/logs/users/devices/preauth با هشدار یک‌بارِ نمایش/routes/backup/verify/restore/update با جدول ۵ مرحله‌ای و قید نسخه‌به‌نسخه/config validate→restart/cameras معرفی کوتاه/report با حذف خودکار حساس/uninstall) + سه سناریو: حذف دستگاه ازدست‌رفته (با headscale preauthkeys expire از FACTS §4)، تغییر دامنه (ویرایش config.yaml و بلوک مارکر Caddy + validate هر دو)، انتقال کامل به VPS جدید (backup→scp→install.sh تعاملی/خودکار طبق hem-install.conf.example→restore→رکورد A→تست /health با کد 200→تست کلاینت‌ها + توضیح صادقانه رفتار کلاینت‌ها).
- فصل ۹: رویکرد «اول doctor» + الگوی چهار سؤالی + نقشه ۶ لایه (DNS/TLS/سرویس/تونل/Route/اپلیکیشن) + جدول سریع + ۱۴ خطای مأموریت، هرکدام با نشانه/دستور بررسی/معنی خروجی/علت/راهکار ایمن (شامل مسیر برگشت با Static Route برای 100.64.0.0/10، پیش‌فرض ۱ ساعته preauth از FACTS، جریان auth register/approve) + بخش خواندن لاگ (hsctl logs + journalctl برای headscale و caddy).
- فصل ۱۰: حفاظت کلیدهای /var/lib/headscale/*.key و پشتیبان‌های /var/backups/hem/ (بررسی ۶۰۰ + chmod)، جدول برنامه نگهداری هفتگی/ماهانه/فصلی/شش‌ماهه، بازیابی آزمایشی روی سرور موقت (نه اصلی!)، سناریوی دستگاه گم‌شده ۵ مرحله‌ای، محدودسازی SSH/مدیریت، بازبینی دوره‌ای ss -tulpn با جدول پورت‌های مجاز (22/80/443/3478 + localhost-only 8080/9090/50443)، تفکیک امنیت تونل vs امنیت CRM، صداقت درباره قطع VPS، ارجاع انتقال به فصل ۸.
- فصل ۱۱: واژه‌نامه ۸۰+ ردیفی در ۶ گروه (شبکه/VPN، آدرس‌ها و مسیریابی، رمزنگاری و وب، سرور و ابزار، مفاهیم Headscale، دستورهای سیستمی این دوره) — هر ۵۵ اصطلاح الزامی مأموریت (تا Captive Portal و Netmap) + موارد تکمیلی (LAN/WAN/Gateway/Static Route/gRPC/Exit Code و…) با ستون‌های انگلیسی/فارسی/توضیح + جدول «چهار تفاوت پرتکرار».
- فصل ۱۲: پروژه داستانی ۱۰ مرحله‌ای آقای رضایی (VPS ۲۴.۰۴ با چک‌لیست → رکورد A + nslookup → install.sh با دیالوگ منطبق بر hem-install.conf.example و ارجاع به فصل ۴ → گوشی اندروید با preauth یک‌بارمصرف → لپ‌تاپ ویندوزی → ساب‌نت‌روتر با sysctl دقیق FACTS §5 و approve → لحظه موفقیت CRM با اینترنت همراه → status/doctor → backup create/verify → خطای عمدی systemctl stop headscale و رفع با doctor/start به‌عنوان تمرین الگوی چهار سؤالی) + جدول چک‌لیست نهایی سلامت ۱۰ بندی.
- فصل ۱۳ (افزونه مأموریت): معماری بدون بازکردن پورت با دیاگرام ASCII عمودی، پیش‌نیاز فصل ۶، شناسایی NVR تک‌IP، دیالوگ hsctl cameras add (پورت‌ها اختیاری، بدون حدس، بدون رمز — منطبق بر فیلدهای hem-install.conf.example)، آموزش عمومی یافتن IP/پورت (روتر/نرم‌افزار سازنده/برچسب)، خروجی cameras check با سه بخش (route/ساب‌نت‌روتر/پورت) + جدول طبقه‌بندی خطا، جداسازی صریح سه لایه (شبکه ≠ احراز هویت ≠ تصویر)، سه توپولوژی (NVR واحد/دوربین مستقل/PoE اختصاصی NVR)، اتصال اندروید با اپ رسمی سازنده (Dahua/DMSS از فروشگاه رسمی، ورود IP داخلی NVR) و لپ‌تاپ با مرورگر، چک‌لیست امنیت (تغییر رمز پیش‌فرض و…)، تست پذیرش ۹ بندی و بند «صداقت در گزارش نتیجه» (ممنوعیت اعلام «اتصال تصویری تأییدشده» بدون تست هر سه لایه).
- فصل ۱۴: کارت «چه چیزی لازم دارم؟»، ۵ گام (SSH→رکورد A→install.sh→tailscale up --login-server→hsctl status)، جدول ۱۰ دستور پرکاربرد hsctl، جدول «می‌خواهم…» با لینک به ۱۲ فصل، جدول ۵ دستور سمت کلاینت، ۶ پرسش سریع، ۳ نکته طلایی ایمنی.
- راستی‌آزمایی نهایی: کلیدواژه‌های همه بلوک‌های bash/powershell استخراج و تک‌به‌تک با FACTS تطبیق داده شد (خروجی در Work Log بالا)؛ توازن code-fenceها و سلامت همه لینک‌های نسبی بررسی شد؛ اصلاح تایپوها (نویسه عربی/چینی سرگردان، «دیگه»، ترتیب جمله)؛ تطبیق IPها و نام دستگاه‌ها با تخصیص ترتیبی 100.64.0.1 و نام‌گذاری فصل‌های ۱-۷.

Stage Summary:
- فصل‌های ۸ تا ۱۴ مرکز آموزش کامل شدند (مجموع ۲۰۳۰ خط markdown)؛ همه دستورات hsctl/headscale/tailscale عیناً از FACTS.md اند و دستورهای سیستمی فقط از مجموعه مجاز مأموریت (systemctl/journalctl/caddy validate/nslookup/ufw/df/timedatectl/ss/scp/curl) انتخاب شدند.
- فایل‌ها با تعداد خط: 08-modiriyat-roozmareh.md (449)، 09-eibyabi.md (449)، 10-amniyat-negahdari.md (216)، 11-vazhenameh.md (155)، 12-poroje-nemooneh.md (350)، 13-dorbin-madarbaste.md (260)، 14-rahnamaye-sari.md (151).
- قالب‌ها رعایت شد: «در این فصل یاد می‌گیرید» + «خلاصه فصل» + لینک نسبی قبلی/بعدی در هر ۷ فصل؛ ۱۵۰-۴۵۰ خط برای هر فصل؛ placeholder برای همه مقادیر حساس (<AUTH_KEY>، <FILE>، <AUTH_ID>، <USER>)؛ هیچ رمز/کلید واقعی.
- یکدستی بین‌فصلی با Task 2-b: office-router/100.64.0.1/دامنه‌های نمونه یکسان؛ فصل ۱۲ داستان مستقل با دستگاه‌های خودش که در فصل ۱۳ ادامه می‌یابد؛ ارجاع‌های متقابل (فصل ۹→۸، ۱۰→۸، ۱۲→۹، ۱۳→۶/۹/۱۰، ۱۴→همه).
- گام‌های بعدی: Task 3 (وب‌اپ) می‌تواند فصل‌ها را از docs/fa با frontmatter (title/description/order/icon) بارگذاری کند؛ عنوان و ترتیب‌ها مطابق FACTS §12 است.

---
Task ID: 2-a
Agent: general-purpose subagent (نوشته‌شده توسط عامل تایم‌اوت‌خورده؛ تکمیل و راستی‌آزمایی‌شده توسط مدیر)
Task: پیاده‌سازی کامل بسته پایتون hem (Installer + hsctl CLI) + تست‌ها

Work Log:
- عامل با موفقیت ~۶۰۰۰ خط کد پایتون در src/hem نوشت اما در پایان (نوشتن README) دچار timeout شد.
- مدیر ادامه داد: اجرای pytest → 53 passed؛ smoke test: hsctl --version/--help/learn list/explain همه سالم.
- راستی‌آزمایی config template در برابر FACTS §3: همه کلیدهای الزامی موجود، کلیدهای ممنوعه نسخه‌های قدیمی غایب ✓
- راستی‌آزمایی ۱۷ گام نصب در installer/flow.py (STEP_TITLES) ✓، قرارداد کامل CLI (۱۷ زیرفرمان) ✓، ثابت‌ها (PINNED_HS_VERSION=0.29.5، SHA-256، مارکرهای Caddy) ✓
- مدیر فایل‌های ناتمام را نوشت: README.md (فارسی جامع)، systemd/README.md (واحد رسمی + override)، SECURITY.md.

Stage Summary:
- بسته پایتون hem کامل است: core(exec/prompts/runner/hemlog) + system(preflight/packages/services/firewall) + network(ips/dnscheck/ports) + headscale(releases/installer/config/ctl) + proxy/caddy + backup(create/restore/manager) + diagnostics(doctor/report) + cameras(registry/checker) + learn(chapters/explain) + installer(answers/flow) + cli.py (~۹۶۰ خط) + i18n فارسی.
- ۸ فایل تست: 53 تست پاس (config render، releases checksums، dnscheck، caddy inject، backup با SQLite واقعی، cameras با mock، learn، CLI smoke).
- hsctl بدون root برای learn/explain/--help کار می‌کند؛ دستورات سیستمی exit 3 می‌دهند.
- محدودیت صادقانه: تست‌های یکپارچه واقعی (systemd/UFW/Caddy/صدور گواهی) نیازمند VPS آزمایشی Ubuntu است.

---

Task ID: 3
Agent: Fullstack Next.js Developer (Z.ai Code)
Task: وب‌اپلیکیشن Next.js — «خانه محصول و مرکز آموزش فارسی Headscale Easy Manager» (مسیر یکتای /)

Work Log:
- worklog.md، docs/FACTS.md، README.md، فصل‌های ۰۱/۰۴/۰۶/۰۹/۱۳ مستندات و STEP_TITLES از src/hem/installer/flow.py مطالعه شد؛ همهٔ داده‌های نمایشی (دستورات، ۱۷ گام، ۱۴ خطا) فقط از همین منابع استخراج شد.
- وابستگی‌ها: bun add remark-gfm js-yaml + @types/js-yaml @types/react-syntax-highlighter — نکتهٔ مهم: js-yaml نسخهٔ ۵ نصب شد که default export ندارد؛ import به { load as yamlLoad } اصلاح شد.
- layout.tsx بازنویسی شد: lang="fa" dir="rtl"، فونت Vazirmatn از CDN گوگل با fallback (Tahoma/system)، ThemeProvider (next-themes, attribute="class", defaultTheme="dark")، متادیتای فارسی.
- globals.css: پالت shadcn به emerald (اصلی) + slate (خنثی) + amber (هشدار) تغییر کرد (بدون هیچ blue/indigo)؛ اسکرول‌بار سفارشی .custom-scrollbar، انیمیشن dash-move برای خطوط دیاگرام، استایل کد درون‌خطی RTL-safe.
- ناوبری hash-based با useSyncExternalStore در src/lib/nav.ts (مسیرهای #/, #/learn, #/learn/6, #/install, #/cli, #/cameras, #/troubleshoot, #/project) — refresh و اشتراک‌گذاری لینک امن است.
- ۴ API Route فقط با fs سمت سرور: /api/docs (فهرست ۱۴ فصل با پارس frontmatter با js-yaml)، /api/docs/[slug] (محتوای markdown بدون frontmatter)، /api/project/tree (درخت کامل با exclude: .git/__pycache__/node_modules/.venv/*.pyc + آمار واقعی: pyLines=۶۷۰۰، testFunctions=۵۳، chapters=۱۴)، /api/project/file (resolve + مسدودسازی path traversal با تست ۴۰۳، سقف ۲۰۰KB با ۴۱۳، رد باینری، تشخیص زبان از پسوند).
- فایل‌های داده: install-steps.ts (۱۷ گام عیناً از STEP_TITLES با ریسک واقعی هر گام + دیالوگ نصب + فایل نمونهٔ conf + ۳ تست سلامت + ۵ FAQ از فصل ۴)، cli-commands.ts (۳ گروه hsctl §11 / headscale §4 / tailscale §5 با ریسک و نکته‌های طلایی)، troubleshooting.ts (۱۴ خطای فصل ۹ با نشانه/دستور/معنی/علت/راهکار + نقشهٔ شش لایه).
- کامپوننت‌ها در src/components/home/: site-header (لوگوی SVG + ناوبری دسکتاپ/موبایل اسکرولی + سوییچ تم CSS-based بدون hydration mismatch)، site-footer چسبان (mt-auto)، code-block (LTR + Prism oneDark + دکمهٔ کپی با fallback)، markdown (react-markdown + remark-gfm؛ بلوک‌های کد LTR با کپی، جداول اسکرول‌پذیر، لینک‌های نسبی فصل‌ها به #/learn/N تبدیل می‌شوند)، architecture-diagram (SVG متحرک دسکتاپ + نسخهٔ عمودی موبایل؛ مسیر کنترل emerald و مسیر داده amber با انیمیشن dashed و prefers-reduced-motion).
- ۷ سکشن: خانه (Hero + Badgeها + CTA + دیاگرام + توضیح صادقانهٔ Control/Data Plane + آمار + ۶ ویژگی + شروع سریع + CTA)، آموزش (سایدبار جستجو + پیشرفت مطالعه با localStorage «خواندم» + علامت‌گذاری خودکار در پایان اسکرول + زمان مطالعه خط/۱۵ + ناوبری قبلی/بعدی)، نصب (۳ تب تعاملی/خودکار/Dry-Run + ۳ کارت پیش‌نیاز + تایم‌لاین ۱۷ گام + دیالوگ تعاملی + چک‌لیست سلامت + FAQ آکاردئونی)، دستورات (تب ۳ گروه + فیلتر دسته + جستجو + کارت ریسک‌دار)، دوربین‌ها (جریان مسیر + هشدار سه‌لایه + ۵ گام + چک‌لیست ۹ بندی localStorage)، عیب‌یابی (جستجو + ۱۴ آکاردئون + شش لایه + لینک فصل ۹)، پروژه (آمار واقعی + درخت فایل باز/بسته‌شو + نمایشگر با syntax highlight).
- انطباق با قوانین جدید eslint (react-hooks v6: set-state-in-effect / refs): هوک useLocalStorageJson با useSyncExternalStore نوشته شد؛ وضعیت فایل/فصل به map های keyed با setState فقط در callback های async تبدیل شد؛ آیکن تم CSS-based شد.
- تست‌ها: lint بدون خطا؛ tsc --noEmit برای src بدون خطا؛ curl همهٔ APIها ۲۰۰ و خطاها (traversal→403، slug نامعتبر→404، پوشه→404)؛ تست مرورگر واقعی با agent-browser (رندر همهٔ بخش‌ها، ناوبری hash، تیک چک‌لیست + ذخیرهٔ localStorage، سوییچ تم، بدون خطای کنسول)؛ تحلیل تصویری VLM دو صفحه (طراحی تمیز، هویت emerald، RTL صحیح، دیاگرام با خطوط dashed سالم).

Stage Summary:
- وب‌اپلیکیشن تک‌صفحه‌ای فارسی RTL با ۷ بخش و ناوبری hash-based کامل شد؛ پیش‌فرض دارک با هویت emerald/teal + slate + amber (بدون آبی/نیلی)، فوتر چسبان، ریسپانسیو موبایل-اول و لمس‌پذیر (≥۴۴px).
- فایل‌های ساخته‌شده: src/app/layout.tsx (بازنویسی)، src/app/page.tsx (بازنویسی)، src/app/globals.css (بازنویسی)، src/lib/nav.ts، src/lib/hem-project.ts، src/hooks/use-local-storage.ts، src/data/{install-steps,cli-commands,troubleshooting}.ts، src/app/api/docs/route.ts، src/app/api/docs/[slug]/route.ts، src/app/api/project/tree/route.ts، src/app/api/project/file/route.ts، src/components/theme-provider.tsx، src/components/home/{site-header,site-footer,code-block,copy-button,markdown,architecture-diagram,chapter-icons}.tsx، src/components/home/sections/{home,learn,install,cli,cameras,troubleshoot,project}-section.tsx.
- نتیجهٔ lint: پاک (eslint بدون خطا و هشدار). نتیجهٔ curl: GET / → 200 (۸۱KB، lang="fa" dir="rtl" و Vazirmatn تأیید شد)؛ /api/docs → 200 با ۱۴ فصل؛ /api/docs/06-dastresi-shabake-daftar → 200؛ /api/project/tree → 200 (۷۹ فایل، ۶۷۰۰ خط پایتون، ۵۳ تست)؛ /api/project/file?path=README.md → 200؛ امنیت: ../package.json و /etc/passwd → 403.
- منبع واحد حقیقت حفظ شد: محتوای آموزش‌ها فقط از docs/fa/*.md از طریق API خوانده می‌شود (بدون کپی در UI)؛ داده‌های نمایشی (دستورات/گام‌ها/خطاها) در فایل‌های TS جدا و عیناً از FACTS/flow.py/فصل ۹.

---
Task ID: 4 (integration + verification)
Agent: Main Orchestrator (Z.ai Code)
Task: یکپارچه‌سازی، تست‌های پایانی و راستی‌آزمایی پایان‌به‌پایان با مرورگر

Work Log:
- lint وب‌اپ پاک (bun run lint بدون خطا)؛ tsc بدون خطا (گزارش عامل 3 + بازبینی مدیر).
- ۵۳ تست پایتون مجدداً اجرا شد: همه پاس.
- راستی‌آزمایی مرورگر (agent-browser):
  * صفحه اصلی: هدر ۷ بخش + تم تاریک/روشن (تست toggle: dark↔light)، Hero، دیاگرام معماری، آمار، ۶ ویژگی، شروع سریع با کپی.
  * مرکز آموزش: هر ۱۴ فصل در سایدبار؛ فصل ۶ با ۲۰ بلوک کد و ۱۱ heading رندر شد؛ کدها LTR داخل صفحه RTL؛ ردیابی خوانده‌شده در localStorage ([6])؛ ناوبری قبلی/بعدی (۹→۱۰ تست شد)؛ دیپ‌لینک #/learn/9 مستقیم کار کرد.
  * نصب: هر ۱۷ گام (۱۷/۱۷) با نرمال‌سازی متن فارسی تطبیق داده شد.
  * دستورات: جستجوی "routes" → "hsctl routes approve" یافت شد؛ فیلتر دسته‌ها موجود.
  * دوربین‌ها: ۵ گام + چک‌لیست تعاملی ۹ بندی (کلیک آیتم ۳ → localStorage hem-camera-acceptance=[true,false,...]).
  * عیب‌یابی: ۵۶ آیتم آکاردئونی (۱۴ خطا) با متن نشانه/راهکار.
  * پروژه: درخت فایل (docs→fa 14 فایل)؛ باز کردن README.md موفق؛ path traversal روی /etc/passwd → 403.
  * موبایل 390px: بدون سرریز افقی؛ فوتر چسبان با ساختار صحیح (div.flex.min-h-screen.flex-col + footer.mt-auto).
  * خطای کنسول: صفر.
- خطاهای تاریخی dev.log (js-yaml default export) بررسی شد: مربوط به میانه توسعه عامل 3؛ فایل‌ها اکنون import { load } دارند و همه APIها 200 برمی‌گردانند (curl تأیید شد).
- تحلیل تصویری (VLM) روی اسکرین‌شات‌ها: صفحه اصلی 9/10 (RTL صحیح، پالت emerald بدون آبی/نیلی، بدون نقص بصری)؛ موبایل و صفحه فصل بدون سرریز/درهم‌رفتگی.
- بسته توزیع download/headscale-easy-manager-v0.1.0.tar.gz + فایل sha256 ساخته شد.
- مخزن headscale-easy-manager با ۲ کامیت (اسکلت + پیاده‌سازی کامل) تمیز است.

Stage Summary:
- محصول کامل و در دسترس: وب‌اپ روی / (تنها مسیر کاربر)، مخزن واقعی در headscale-easy-manager/، آرشیو قابل دانلود.
- راستی‌آزمایی مرورگر پایان‌به‌پایان انجام شد و همه جریان‌های اصلی (ناوبری هفت بخش، آموزش، جستجو، چک‌لیست، مرورگر فایل، تم، موبایل) سالم‌اند.
- محدودیت صادقانه باقی‌مانده: تست‌های یکپارچه واقعی روی VPS اوبونتو (systemd/UFW/Caddy/صدور گواهی/اتصال کلاینت واقعی) خارج از این محیط است و باید روی سرور آزمایشی اجرا شود (سناریو در فصل ۱۲).
