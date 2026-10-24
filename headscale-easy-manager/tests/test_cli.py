"""تست CLI — دستورهای بدون root باید کار کنند و status بدون root کد ۳ بدهد."""

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def run_cli(*args):
    """اجرای python3 hsctl <args> در ریشه مخزن."""
    return subprocess.run(
        [sys.executable, "hsctl", *args],
        cwd=REPO, capture_output=True, text=True, timeout=120,
    )


def test_help():
    result = run_cli("--help")
    assert result.returncode == 0
    assert "hsctl" in result.stdout
    assert "install" in result.stdout
    assert "learn" in result.stdout


def test_version():
    result = run_cli("--version")
    assert result.returncode == 0
    # نسخه از خود بسته خوانده می‌شود تا با هر ارتقا به‌روز بماند (v0.3.0)
    from hem import __version__
    assert __version__ in result.stdout


def test_learn_list():
    result = run_cli("learn", "list")
    assert result.returncode == 0
    assert "فصل" in result.stdout
    assert "VPN" in result.stdout


def test_learn_chapter():
    result = run_cli("learn", "1")
    assert result.returncode == 0


def test_explain_routes():
    result = run_cli("explain", "routes")
    assert result.returncode == 0
    assert "Route" in result.stdout


def test_explain_subnet_router_fuzzy():
    result = run_cli("explain", "subnet")
    assert result.returncode == 0
    assert "Subnet Router" in result.stdout


def test_explain_unknown_topic():
    result = run_cli("explain", "definitely-not-a-topic-xyz")
    assert result.returncode == 2


def test_report_without_root():
    result = run_cli("report")
    assert result.returncode == 0
    assert "گزارش" in result.stdout or "report" in result.stdout.lower()
    # پاک‌سازی فایل گزارش تولیدشده در پوشه موقت جاری (اگر لاگ قابل نوشتن نبود)
    for report in REPO.glob("hem-report-*.txt"):
        report.unlink()


def test_status_requires_root():
    if os.geteuid() == 0:
        return  # در محیط root این تست معنا ندارد
    result = run_cli("status")
    assert result.returncode == 3
    assert "sudo" in result.stdout


def test_invalid_command():
    result = run_cli("no-such-command")
    assert result.returncode != 0
