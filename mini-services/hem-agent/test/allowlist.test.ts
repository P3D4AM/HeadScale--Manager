// Console allowlist tests (spec §9) — security, no free-form shell
import { describe, expect, test } from "bun:test";
import { checkCommand, previewCommand } from "../src/allowlist";

const ctx = { host: "127.0.0.1" };

describe("allow/deny of permitted roots", () => {
  test("headscale users list is allowed", () => {
    const r = checkCommand("headscale users list", ctx);
    expect(r.allowed).toBe(true);
    expect(r.exactCommand).toBe("headscale users list");
  });

  test("hsctl status is allowed", () => {
    expect(checkCommand("hsctl status", ctx).allowed).toBe(true);
  });

  test("hsctl backup create is allowed (HEM's own tool)", () => {
    expect(checkCommand("hsctl backup create", ctx).allowed).toBe(true);
  });

  test("systemctl only status/is-active/is-enabled", () => {
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
    expect(checkCommand("journalctl -u 'headscale; rm -rf /'", ctx).allowed).toBe(false); // ';' forbidden
  });

  test("curl only -s -m to an allowed host", () => {
    expect(checkCommand("curl -s -m 5 http://127.0.0.1:8080/health", ctx).allowed).toBe(true);
    expect(checkCommand("curl -s -m 5 http://localhost:8080/health", ctx).allowed).toBe(true);
    expect(checkCommand("curl http://evil.com", ctx).allowed).toBe(false);
    expect(checkCommand("curl -s -m 5 http://evil.com", ctx).allowed).toBe(false);
    expect(checkCommand("curl -s -m 5 https://127.0.0.1:9090/metrics", ctx).allowed).toBe(true);
    expect(checkCommand("curl -s -m 999 http://127.0.0.1/health", ctx).allowed).toBe(false);
    expect(checkCommand("curl -X POST http://127.0.0.1/health", ctx).allowed).toBe(false);
  });

  test("ufw only status", () => {
    expect(checkCommand("ufw status", ctx).allowed).toBe(true);
    expect(checkCommand("ufw status verbose", ctx).allowed).toBe(true);
    expect(checkCommand("ufw allow 22", ctx).allowed).toBe(false);
    expect(checkCommand("ufw enable", ctx).allowed).toBe(false);
  });

  test("df -h and ss -tulpn", () => {
    expect(checkCommand("df -h", ctx).allowed).toBe(true);
    expect(checkCommand("ss -tulpn", ctx).allowed).toBe(true);
    expect(checkCommand("df -h /var", ctx).allowed).toBe(false); // strict per the spec
  });
});

describe("blocking", () => {
  test("semicolon and rm -rf", () => {
    const r = checkCommand("headscale users list; rm -rf /", ctx);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  test("backtick", () => {
    expect(checkCommand("headscale users list `id`", ctx).allowed).toBe(false);
  });

  test("command substitution $()", () => {
    expect(checkCommand("headscale users list $(id)", ctx).allowed).toBe(false);
  });

  test("&& to another command", () => {
    expect(checkCommand("headscale users list && rm -rf /", ctx).allowed).toBe(false);
  });

  test("pipe to a disallowed program", () => {
    expect(checkCommand("headscale users list | sh", ctx).allowed).toBe(false);
    expect(checkCommand("ss -tulpn | grep 8080", ctx).allowed).toBe(false); // pipes forbidden — strict
  });

  test("unknown binary", () => {
    expect(checkCommand("rm -rf /", ctx).allowed).toBe(false);
    expect(checkCommand("echo hi", ctx).allowed).toBe(false);
    expect(checkCommand("bash", ctx).allowed).toBe(false);
    expect(checkCommand("/bin/sh -c id", ctx).allowed).toBe(false);
  });

  test("empty command and unclosed quote", () => {
    expect(checkCommand("", ctx).allowed).toBe(false);
    expect(checkCommand("headscale 'users", ctx).allowed).toBe(false);
  });

  test("metacharacters", () => {
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

describe("preview: exact argv reconstruction", () => {
  test("whitespace normalization", () => {
    const r = previewCommand("headscale   users    list", ctx);
    expect(r.allowed).toBe(true);
    expect(r.exactCommand).toBe("headscale users list");
  });

  test("safe argument quoting", () => {
    const r = previewCommand('headscale users create "my user"', ctx);
    expect(r.allowed).toBe(true);
    expect(r.exactCommand).toBe("headscale users create 'my user'");
  });

  test("argv output", () => {
    const r = previewCommand("curl -s -m 5 http://127.0.0.1:8080/health", ctx);
    expect(r.argv).toEqual(["curl", "-s", "-m", "5", "http://127.0.0.1:8080/health"]);
  });

  test("a blocked command has an empty exactCommand", () => {
    const r = previewCommand("rm -rf /", ctx);
    expect(r.allowed).toBe(false);
    expect(r.exactCommand).toBe("");
  });
});
