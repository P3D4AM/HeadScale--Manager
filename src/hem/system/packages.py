"""مدیریت بسته‌های apt — نصب، حذف و پرس‌وجو (همه از طریق core.exec.run)."""

from __future__ import annotations

from hem.core.exec import ExecResult, run

_APT_ENV = {"DEBIAN_FRONTEND": "noninteractive"}


def apt_update(dry_run: bool = False, timeout: float = 600) -> ExecResult:
    """به‌روزرسانی فهرست بسته‌ها (apt-get update)."""
    return run(["apt-get", "update"], env=_APT_ENV, dry_run=dry_run, timeout=timeout)


def apt_install(names: list, dry_run: bool = False, timeout: float = 1800) -> ExecResult:
    """نصب بسته(ها) از مخزن apt."""
    return run(["apt-get", "install", "-y", *names], env=_APT_ENV, dry_run=dry_run, timeout=timeout)


def apt_remove(names: list, purge: bool = False, dry_run: bool = False, timeout: float = 1800) -> ExecResult:
    """حذف (یا purge) بسته‌ها."""
    action = "purge" if purge else "remove"
    return run(["apt-get", action, "-y", *names], env=_APT_ENV, dry_run=dry_run, timeout=timeout)


def apt_install_local(deb_path, dry_run: bool = False, timeout: float = 1800) -> ExecResult:
    """نصب یک فایل .deb محلی از طریق apt (مسیر کامل داده شود)."""
    return run(["apt-get", "install", "-y", str(deb_path)], env=_APT_ENV, dry_run=dry_run, timeout=timeout)


def dpkg_installed(name: str) -> bool:
    """آیا بسته‌ای با این نام نصب شده است؟"""
    res = run(["dpkg-query", "-W", "-f=${Status}", name], check=False, timeout=30)
    return res.returncode == 0 and "install ok installed" in res.stdout
