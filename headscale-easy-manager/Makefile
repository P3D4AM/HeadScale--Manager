# Headscale Easy Manager — ابزارهای توسعه
.PHONY: help install dev test lint clean

help:
	@echo "install   - نصب در مسیر محلی (editable) برای توسعه"
	@echo "dev       - نصب ابزارهای توسعه (pytest, ruff)"
	@echo "test      - اجرای تست‌ها (pytest)"
	@echo "lint      - بررسی کیفیت کد (ruff)"
	@echo "clean     - پاک‌سازی فایل‌های موقت"

install:
	python3 -m pip install -e .

dev:
	python3 -m pip install -e ".[dev]"

test:
	python3 -m pytest tests/ -v

lint:
	python3 -m ruff check src/ tests/ hsctl

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	rm -rf .pytest_cache .ruff_cache build dist *.egg-info
