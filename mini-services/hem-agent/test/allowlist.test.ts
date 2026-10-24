// تست allowlist کنسول (قرارداد §9) — امنیت، بدون شل آزاد
import { describe, expect, test } from "bun:test";
import { checkCommand, previewCommand } from "../src/allowlist";

const ctx = { host: "127.0.0.1" };

describe("اجازه/رد ریشه‌های مجاز", () => {
  test("headscale users list مجاز", () => {
    const r = checkCommand("headscale users list", ctx);
    expect(r.allowed).toBe(true);
    expect(r.exactCommand).toBe("headscale users list");
  });

  test("hsctl status مجاز", () => {
    expect(checkCommand("hsctl status", ctx).allowed).toBe(true);
  });

  test("hsctl backup create مجاز (خود ابزار HEM)", () => {
    expect(checkCommand("hsctl backup create", ctx).allowed).toBe(true);
  });

  test("systemctl فقط status/is-active/is-enabled", () => {
    expect(checkCommand("systemctl status headscale", ctx).allowed).toBe(true);
    expect(checkCommand("systemctl is-active ssh", ctx).allowed).toBe(true);
    expect(checkCommand("systemctl stop headscale", ctx).allowed).toBe(false);
    expect(checkCommand("systemctl restart caddy", ctx).allowed).toBe(false);
  });

  test("journalctl -u <unit> [-n N]", () => {
    expect(checkCommand("journalctl -u headscale", ctx).allowed).toBe(true);
    expect(checkCommand("journalctl -u headscale -n 100", ctx).allowed).toBe(true);
    expect(checkCommand("journalctl -u headscale -n 100 --no-pager", ctx).allowed).toBe(true);
    expect(checkCommand("journalctl --vacuum-time=1d", ctx).allowed).toBe(false);
    expect(checkCommand("journalctl -u 'headscale; rm -rf /'", ctx).allowed).toBe(false); // ; ممنوع
  });

  test("curl فقط -s -m به میزبان مجاز", () => {
    expect(checkCommand("curl -s -m 5 http://127.0.0.1:8080/health", ctx).allowed).toBe(true);
    expect(checkCommand("curl -s -m 5 http://localhost:8080/health", ctx).allowed).toBe(true);
    expect(checkCommand("curl http://evil.com", ctx).allowed).toBe(false);
    expect(checkCommand("curl -s -m 5 http://evil.com", ctx).allowed).toBe(false);
    expect(checkCommand("curl -s -m 5 https://127.0.0.1:9090/metrics", ctx).allowed).toBe(true);
    expect(checkCommand("curl -s -m 999 http://127.0.0.1/health", ctx).allowed).toBe(false);
    expect(checkCommand("curl -X POST http://127.0.0.1/health", ctx).allowed).toBe(false);
  });

  test("ufw فقط status", () => {
    expect(checkCommand("ufw status", ctx).allowed).toBe(true);
    expect(checkCommand("ufw status verbose", ctx).allowed).toBe(true);
    expect(checkCommand("ufw allow 22", ctx).allowed).toBe(false);
    expect(checkCommand("ufw enable", ctx).allowed).toBe(false);
  });

  test("df -h و ss -tulpn", () => {
    expect(checkCommand("df -h", ctx).allowed).toBe(true);
    expect(checkCommand("ss -tulpn", ctx).allowed).toBe(true);
    expect(checkCommand("df -h /var", ctx).allowed).toBe(false); // سخت‌گیرانه طبق قرارداد
  });
});

describe("مسدودسازی", () => {
  test("سمی‌کالن و rm -rf", () => {
    const r = checkCommand("headscale users list; rm -rf /", ctx);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  test("بک‌تیک", () => {
    expect(checkCommand("headscale users list `id`", ctx).allowed).toBe(false);
  });

  test("جایگزینی فرمان $()", () => {
    expect(checkCommand("headscale users list $(id)", ctx).allowed).toBe(false);
  });

  test("&& به دستور دیگر", () => {
    expect(checkCommand("headscale users list && rm -rf /", ctx).allowed).toBe(false);
  });

  test("پایپ به برنامهٔ غیرمجاز", () => {
    expect(checkCommand("headscale users list | sh", ctx).allowed).toBe(false);
    expect(checkCommand("ss -tulpn | grep 8080", ctx).allowed).toBe(false); // پایتپ ممنوع — سخت‌گیرانه
  });

  test("باینری ناشناس", () => {
    expect(checkCommand("rm -rf /", ctx).allowed).toBe(false);
    expect(checkCommand("echo hi", ctx).allowed).toBe(false);
    expect(checkCommand("bash", ctx).allowed).toBe(false);
    expect(checkCommand("/bin/sh -c id", ctx).allowed).toBe(false);
  });

  test("دستور خالی و کوت باز", () => {
    expect(checkCommand("", ctx).allowed).toBe(false);
    expect(checkCommand("headscale 'users", ctx).allowed).toBe(false);
  });

  test("کاراکترهای متکار", () => {
    for (const cmd of [
      "headscale users list > /etc/passwd",
      "headscale users list >> /tmp/x",
      "headscale users list & rm -rf /",
      "headscale users list | cat",
      "headscale users \\; list",
    ]) {
      expect(checkCommand(cmd, ctx).allowed).toBe(false);
    }
  });
});

describe("preview: بازسازی argv دقیق", () => {
  test("نرمال‌سازی فاصله‌ها", () => {
    const r = previewCommand("headscale   users    list", ctx);
    expect(r.allowed).toBe(true);
    expect(r.exactCommand).toBe("headscale users list");
  });

  test("کوت‌گذاری ایمن آرگومان", () => {
    const r = previewCommand('headscale users create "my user"', ctx);
    expect(r.allowed).toBe(true);
    expect(r.exactCommand).toBe("headscale users create 'my user'");
  });

  test("خروجی argv", () => {
    const r = previewCommand("curl -s -m 5 http://127.0.0.1:8080/health", ctx);
    expect(r.argv).toEqual(["curl", "-s", "-m", "5", "http://127.0.0.1:8080/health"]);
  });

  test("دستور مسدود exactCommand خالی دارد", () => {
    const r = previewCommand("rm -rf /", ctx);
    expect(r.allowed).toBe(false);
    expect(r.exactCommand).toBe("");
  });
});
