"""تست ۴.۳ — YAML تک‌منبعی: مثال Canonical، نمونهٔ وب و FACTS §4.

این تست‌ها «نگهبان CI» هستند: هر انحراف schema (در examples/، نمونهٔ وب،
docs/FACTS.md) باید تست‌ها را شکست دهد.
"""

import re
from pathlib import Path

import pytest
import yaml

from hem.installer.answers import InstallAnswers, from_dict, load_from_file

REPO = Path(__file__).resolve().parents[1]
EXAMPLE = REPO / "examples" / "hem-install.conf.example"
FACTS = REPO / "docs" / "FACTS.md"
WEB_TS = REPO.parent / "src" / "data" / "install-steps.ts"  # پروژهٔ وب کنار مخزن

# مجموعهٔ کلیدهای پذیرفته‌شدهٔ parser واقعی + نام مستعار قدیمی caddy
ACCEPTED_KEYS = set(InstallAnswers.__dataclass_fields__) | {"caddy"}


def test_example_conf_loads_and_validates():
    """(الف) مثال Canonical با parser واقعی بارگذاری و validate می‌شود."""
    answers = load_from_file(str(EXAMPLE))  # خطای validate داخل خودش ValueError می‌دهد
    assert answers.validate() == []
    assert answers.domain == "headscale.example.com"
    assert answers.magic_dns_base == "ts.example.com"
    assert answers.caddy_mode in ("install", "reuse", "skip")
    assert answers.magic_dns_base != answers.domain


def _web_yaml_sample() -> str:
    """استخراج بلوک YAML نمونه از فایل TS (متغیر AUTO_INSTALL_CONF_SAMPLE)."""
    if not WEB_TS.exists():
        pytest.skip(f"نمونهٔ وب در این محیط موجود نیست: {WEB_TS}")
    text = WEB_TS.read_text(encoding="utf-8")
    match = re.search(r"AUTO_INSTALL_CONF_SAMPLE\s*=\s*`(.*?)`", text, re.DOTALL)
    assert match, "بلوک AUTO_INSTALL_CONF_SAMPLE در install-steps.ts پیدا نشد"
    return match.group(1)


def test_web_yaml_sample_matches_real_parser(tmp_path):
    """(ب) نمونهٔ وب: هر کلید در مجموعهٔ پذیرفته‌شده است و با parser واقعی معتبر است."""
    sample = _web_yaml_sample()

    # محتوای «فعال» نمونه (بدون خطوط/یادداشت‌های کامنت) — کلیدهای نامعتبر ممیزی نباید برگردند:
    active = "\n".join(line.split("#", 1)[0] for line in sample.splitlines())
    assert "install_new" not in active, "مقدار نامعتبر caddy_mode: install_new هنوز هست"
    assert "magic_dns:" not in active, "کلید قدیمی magic_dns: هنوز هست"
    assert "dns_status" not in active, "کلید نامعتبر dns_status هنوز هست"
    assert "ufw_enabled" not in active, "کلید نامعتبر ufw_enabled هنوز هست"

    data = yaml.safe_load(sample)
    assert isinstance(data, dict), "نمونهٔ وب باید نگاشت YAML باشد"
    for key in data:
        assert key in ACCEPTED_KEYS, (
            f"کلید «{key}» در parser واقعی (answers.py) وجود ندارد — schema drift"
        )

    # بارگذاری با همان مسیر واقعی (load_from_file) از فایل موقت:
    tmp_conf = tmp_path / "web-sample.yaml"
    tmp_conf.write_text(sample, encoding="utf-8")
    answers = load_from_file(str(tmp_conf))
    assert answers.validate() == []
    assert answers.caddy_mode in ("install", "reuse", "skip")


def test_facts_preauth_section_has_real_syntax():
    """(ج) FACTS §4 نباید دستور ساختگی «preauthkeys list --user» را داشته باشد."""
    facts = FACTS.read_text(encoding="utf-8")
    assert "preauthkeys list --user" not in facts, (
        "در 0.29.5 دستور «preauthkeys list» فلگ --user ندارد (برگرفته از باینری واقعی)"
    )
    # و نکتهٔ واقعی ثبت شده باشد:
    assert "preauthkeys list" in facts
    assert "policy set --file" in facts, "سینتکس واقعی policy set ثبت نشده"
    assert "--new-name" in facts, "سینتکس واقعی users rename ثبت نشده"
