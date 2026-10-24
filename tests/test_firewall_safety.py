"""تست ۴.۶ — ایمنی UFW: snapshot قبل از تغییر، رضایت صریح، بررسی فعال‌سازی و rollback.

  (الف) شکست «ufw --force enable» → NeedsActionError (نه گزارش موفقیت).
  (ب) سرویس سفارشی روی پورت 8443 (0.0.0.0) + غیرتعاملی → توقف با NeedsActionError
        و نام‌بردن از سرویس/پورت.
  (ج) همان سناریو در حالت تعاملی → انتخاب «لغو»، فایروال فعال نمی‌شود.
  (د) فایل snapshot با متن قواعد و پورت‌ها (۰۶۰۰) نوشته می‌شود.
  (هـ) rollback: فقط قواعد خودمان حذف + غیرفعال‌سازی ufw اگر خودمان فعال کرده بودیم.
"""


import pytest

from hem import constants as C
from hem.core import prompts
from hem.core.exec import ExecResult, HemExecError
from hem.core.runner import NeedsActionError
from hem.system import firewall

_SS_CLEAN = """\
Netid  State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
tcp    LISTEN 0      128        0.0.0.0:22         0.0.0.0:*     users:(("sshd",pid=800,fd=3))
tcp    LISTEN 0      5          127.0.0.1:5432     0.0.0.0:*     users:(("postgres",pid=900,fd=5))
udp    UNCONN 0      0          0.0.0.0:3478       0.0.0.0:*     users:(("derper",pid=910,fd=6))
"""

_SS_RISKY = _SS_CLEAN + (
    'tcp    LISTEN 0      128        0.0.0.0:8443       0.0.0.0:*     '
    'users:(("custom-svc",pid=950,fd=4))\n'
)


def _fake_run_factory(ss_text: str, *, enable_fails=False, commands=None):
    """run شبیه‌سازی‌شده: پاسخ به ufw/ss/nft/iptables — بقیه خطا می‌دهد."""

    def fake_run(cmd, check=True, timeout=None, dry_run=False, env=None, **kw):
        commands.append(list(cmd))
        if cmd[:2] == ["ufw", "status"] and len(cmd) == 2:
            return ExecResult(0, "Status: inactive\n", "", cmd)
        if cmd[:3] == ["ufw", "status", "verbose"]:
            return ExecResult(0, "Status: inactive\nDefault: deny (incoming)\n", "", cmd)
        if cmd[:2] == ["ss", "-tulpn"]:
            return ExecResult(0, ss_text, "", cmd)
        if cmd[0] in ("nft", "iptables"):
            return ExecResult(1, "", "", cmd)  # فایروال دیگری فعال نیست
        if cmd[:3] == ["ufw", "--force", "enable"]:
            if enable_fails:
                raise HemExecError(ExecResult(1, "", "enable failed", cmd))
            return ExecResult(0, "Firewall is active and enabled on system startup\n", "", cmd)
        if cmd[:3] == ["ufw", "--force", "disable"]:
            return ExecResult(0, "Firewall stopped and disabled on system startup\n", "", cmd)
        if cmd[:2] == ["ufw", "allow"]:
            return ExecResult(0, "Rule added", "", cmd)
        if cmd[:2] == ["ufw", "delete"]:
            return ExecResult(0, "Rule deleted", "", cmd)
        raise AssertionError(f"فرمان غیرمنتظره: {cmd}")

    return fake_run


def _setup_firewall_mocks(monkeypatch, ss_text, *, enable_fails=False):
    commands: list[list] = []
    monkeypatch.setattr(firewall, "run", _fake_run_factory(ss_text, enable_fails=enable_fails, commands=commands))
    monkeypatch.setattr(firewall, "which", lambda name: "/usr/sbin/ufw" if name == "ufw" else None)
    return commands


# ─── (الف) شکست فعال‌سازی → مشکل، نه موفقیت ────────────────────────────

def test_enable_failure_raises_not_success(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(C, "BACKUP_DIR", str(tmp_path / "backups"))
    commands = _setup_firewall_mocks(monkeypatch, _SS_CLEAN, enable_fails=True)
    state = {}

    with pytest.raises(NeedsActionError) as excinfo:
        firewall.firewall_setup(22, derper_enabled=False, dry_run=False, state=state)
    assert "فعال‌سازی ufw ناموفق بود" in str(excinfo.value)
    # قواعد تلاش‌شده ثبت شده‌اند تا uninstall/rollback بداند چه پاک کند
    assert state["firewall_rules_added"] == ["22/tcp", "80/tcp", "443/tcp"]
    # فرمان enable واقعاً اجرا شده (نتیجه‌اش دیگر نادیده گرفته نمی‌شود)
    assert ["ufw", "--force", "enable"] in commands


# ─── (ب) سرویس بیرونی ناشناس + غیرتعاملی → توقف کامل ────────────────────

def test_risky_service_noninteractive_stops(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(C, "BACKUP_DIR", str(tmp_path / "backups"))
    commands = _setup_firewall_mocks(monkeypatch, _SS_RISKY)
    monkeypatch.setattr(prompts, "_NON_INTERACTIVE", True)

    with pytest.raises(NeedsActionError) as excinfo:
        firewall.firewall_setup(22, derper_enabled=False, dry_run=False, state={})
    msg = str(excinfo.value)
    assert "custom-svc" in msg, "نام فرایند باید در پیام باشد"
    assert "8443" in msg, "پورت باید در پیام باشد"
    # هیچ قاعده‌ای اضافه نشده و فعال‌سازی انجام نشده
    assert not any(cmd[:2] == ["ufw", "allow"] for cmd in commands)
    assert ["ufw", "--force", "enable"] not in commands
    out = capsys.readouterr().out
    assert "custom-svc" in out and "8443" in out  # هشدار فارسی با فرایند+پورت


# ─── (ج) تعاملی: انتخاب لغو → فایروال فعال نمی‌شود ──────────────────────

def test_risky_service_interactive_cancel_aborts(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(C, "BACKUP_DIR", str(tmp_path / "backups"))
    commands = _setup_firewall_mocks(monkeypatch, _SS_RISKY)
    monkeypatch.setattr(prompts, "_NON_INTERACTIVE", False)
    choices_seen = []
    monkeypatch.setattr(
        firewall, "select",
        lambda prompt, opts: choices_seen.append(opts) or "cancel",
    )

    added, problem = firewall.firewall_setup(22, derper_enabled=False, dry_run=False, state={})
    assert added == []
    assert problem and "لغو" in problem
    # گزینه‌های انتخاب: لغو (پیش‌فرض) و ادامه با شرح صریح قطع‌شدن
    assert choices_seen, "باید select با گزینهٔ ادامه/لغو پرسیده شود"
    labels = [label for _key, label in choices_seen[0]]
    assert any("لغو" in label for label in labels)
    assert any("قطع" in label for label in labels)
    # هیچ تغییری اعمال نشد
    assert not any(cmd[:2] == ["ufw", "allow"] for cmd in commands)
    assert ["ufw", "--force", "enable"] not in commands


def test_risky_service_interactive_continue_proceeds(tmp_path, monkeypatch, capsys):
    """رضایت صریح «ادامه» → قواعد اضافه و فعال‌سازی انجام می‌شود (مسیر مجاز)."""
    monkeypatch.setattr(C, "BACKUP_DIR", str(tmp_path / "backups"))
    commands = _setup_firewall_mocks(monkeypatch, _SS_RISKY)
    monkeypatch.setattr(prompts, "_NON_INTERACTIVE", False)
    monkeypatch.setattr(firewall, "select", lambda prompt, opts: "continue")

    state = {}
    added, problem = firewall.firewall_setup(22, derper_enabled=True, dry_run=False, state=state)
    assert problem is None
    assert added == ["22/tcp", "80/tcp", "443/tcp", "3478/udp"]
    assert ["ufw", "--force", "enable"] in commands
    assert state["firewall_enabled_by_hem"] is True


def test_loopback_and_allowed_ports_do_not_block(tmp_path, monkeypatch, capsys):
    """سرویس روی loopback (postgres:5432) و پورت‌های مجاز هشدار/توقف نمی‌دهند."""
    monkeypatch.setattr(C, "BACKUP_DIR", str(tmp_path / "backups"))
    _setup_firewall_mocks(monkeypatch, _SS_CLEAN)
    monkeypatch.setattr(prompts, "_NON_INTERACTIVE", True)  # حتی غیرتعاملی

    added, problem = firewall.firewall_setup(22, derper_enabled=True, dry_run=False, state={})
    assert problem is None
    assert "3478/udp" in added
    out = capsys.readouterr().out
    assert "postgres" not in out and "5432" not in out


# ─── (د) فایل snapshot با قواعد + پورت‌ها ───────────────────────────────

def test_snapshot_file_written_with_rules_and_ports(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(C, "BACKUP_DIR", str(tmp_path / "backups"))
    _setup_firewall_mocks(monkeypatch, _SS_CLEAN)

    state = {}
    firewall.firewall_setup(22, derper_enabled=False, dry_run=False, state=state)

    snap_dir = tmp_path / "backups" / "firewall"
    files = list(snap_dir.glob("firewall-snapshot-*.txt"))
    assert files, "فایل snapshot باید در BACKUP_DIR/firewall نوشته شود"
    content = files[0].read_text(encoding="utf-8")
    assert "Status: inactive" in content, "متن ufw status verbose باید ذخیره شود"
    assert "0.0.0.0:22" in content and "sshd" in content, "خروجی ss با فرایندها باید ذخیره شود"
    assert (files[0].stat().st_mode & 0o777) == 0o600, "دسترسی فایل باید ۰۶۰۰ باشد"
    # در state هم ثبت شده است
    snap = state["firewall_snapshot"]
    assert "Status: inactive" in snap["ufw_status_verbose"]
    assert "0.0.0.0:22" in snap["ss_tulpn"]
    assert snap["file"] == str(files[0])


# ─── (هـ) rollback فقط کارهای خودمان را برمی‌گرداند ──────────────────────

def test_firewall_rollback_removes_rules_and_disables(tmp_path, monkeypatch):
    commands = _setup_firewall_mocks(monkeypatch, _SS_CLEAN)
    state = {
        "firewall_rules_added": ["22/tcp", "80/tcp", "443/tcp"],
        "firewall_enabled_by_hem": True,
    }
    removed, disabled = firewall.firewall_rollback(state)
    assert removed == 3
    assert disabled is True
    # فقط قواعد خودمان — با ترتیب delete allow
    deletes = [cmd for cmd in commands if cmd[:2] == ["ufw", "delete"]]
    assert deletes == [
        ["ufw", "delete", "allow", "22/tcp"],
        ["ufw", "delete", "allow", "80/tcp"],
        ["ufw", "delete", "allow", "443/tcp"],
    ]
    assert ["ufw", "--force", "disable"] in commands, "ufw که خودمان فعال کردیم باید غیرفعال شود"


def test_firewall_rollback_without_enable_keeps_ufw(tmp_path, monkeypatch):
    """اگر خودمان فعال نکرده باشیم → rollback فقط قواعد را حذف می‌کند."""
    commands = _setup_firewall_mocks(monkeypatch, _SS_CLEAN)
    state = {"firewall_rules_added": ["22/tcp"]}
    removed, disabled = firewall.firewall_rollback(state)
    assert removed == 1
    assert disabled is False
    assert ["ufw", "--force", "disable"] not in commands


def test_parse_ss_listeners_shapes():
    """پارس ss: تورفتگی/پیشوند IPv6 و استخراج فرایند."""
    listeners = firewall.parse_ss_listeners(_SS_RISKY)
    by_port = {ln.port: ln for ln in listeners}
    assert by_port[22].process == "sshd"
    assert by_port[22].bind == "0.0.0.0"
    assert by_port[5432].bind == "127.0.0.1"  # loopback
    assert by_port[8443].process == "custom-svc"
    assert by_port[3478].proto == "udp"

    ipv6 = "tcp   LISTEN 0 128 [::]:9090 [::]:* users:((\"headscale\",pid=1,fd=7))"
    parsed = firewall.parse_ss_listeners(ipv6)
    assert parsed[0].bind == "::" and parsed[0].port == 9090
