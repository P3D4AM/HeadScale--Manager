#!/usr/bin/env python3
"""تولید فیکسچرهای کلید SSH برای تست‌های hem-agent (فقط تست).

استفاده:
    /home/z/.venv/bin/python3 test/fixtures/gen.py

خروجی‌ها (همه فقط برای تست؛ هرگز در محصول استفاده نشوند):
  - id_ed25519 / id_ed25519.pub        — کلید OpenSSH بدون passphrase
  - id_ed25519_pass / id_ed25519_pass.pub — کلید OpenSSH با passphrase «test-pass»
  - id_rsa / id_rsa.pub                — کلید RSA PKCS#1 PEM
  - keys.json                          — رمز/عبارت عبور آزمایشی برای تست‌ها
"""

import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa

OUT = Path(__file__).resolve().parent
PASSPHRASE = b"test-pass"


def write_ed25519(no_pass: bool) -> None:
    key = ed25519.Ed25519PrivateKey.generate()
    enc = (
        serialization.NoEncryption()
        if no_pass
        else serialization.BestAvailableEncryption(PASSPHRASE)
    )
    priv = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.OpenSSH,
        enc,
    )
    pub = key.public_key().public_bytes(
        serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH
    )
    stem = "id_ed25519" if no_pass else "id_ed25519_pass"
    (OUT / stem).write_bytes(priv)
    (OUT / f"{stem}.pub").write_bytes(pub + b"\n")
    (OUT / stem).chmod(0o600)


def write_rsa() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,  # PKCS#1 «BEGIN RSA PRIVATE KEY»
        serialization.NoEncryption(),
    )
    pub = key.public_key().public_bytes(
        serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH
    )
    (OUT / "id_rsa").write_bytes(priv)
    (OUT / "id_rsa.pub").write_bytes(pub + b"\n")
    (OUT / "id_rsa").chmod(0o600)


def main() -> None:
    write_ed25519(no_pass=True)
    write_ed25519(no_pass=False)
    write_rsa()
    (OUT / "keys.json").write_text(
        json.dumps(
            {"password": "hemtest-pass", "passphrase": "test-pass", "note": "test-only secrets"},
            indent=2,
        )
        + "\n"
    )
    print("fixtures regenerated in", OUT)


if __name__ == "__main__":
    main()
