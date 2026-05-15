import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  signSessionId,
  verifySessionCookieValue,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/sessions";
import {
  readSessionCookieFromHeader,
  serialiseSessionCookie,
  serialiseSessionLogoutCookie,
} from "@/lib/auth/cookies";

const SECRET = "a".repeat(48);
const OTHER_SECRET = "b".repeat(48);

describe("session cookie HMAC", () => {
  const original = process.env.SESSION_SECRET;
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
  });

  it("signs a session id and verifies it back", () => {
    const signed = signSessionId("abc-123");
    expect(signed.startsWith("abc-123.")).toBe(true);
    expect(verifySessionCookieValue(signed)).toBe("abc-123");
  });

  it("rejects a tampered signature", () => {
    const signed = signSessionId("abc-123");
    const tampered = signed.slice(0, -1) + (signed.endsWith("a") ? "b" : "a");
    expect(verifySessionCookieValue(tampered)).toBeNull();
  });

  it("rejects a signature produced with a different secret", () => {
    const signed = signSessionId("abc-123", OTHER_SECRET);
    expect(verifySessionCookieValue(signed)).toBeNull();
  });

  it("rejects malformed cookie values", () => {
    expect(verifySessionCookieValue(undefined)).toBeNull();
    expect(verifySessionCookieValue(null)).toBeNull();
    expect(verifySessionCookieValue("")).toBeNull();
    expect(verifySessionCookieValue("no-dot")).toBeNull();
    expect(verifySessionCookieValue(".no-id")).toBeNull();
    expect(verifySessionCookieValue("no-sig.")).toBeNull();
  });

  it("throws if SESSION_SECRET is missing", () => {
    delete process.env.SESSION_SECRET;
    expect(() => signSessionId("abc")).toThrow(/SESSION_SECRET/);
  });

  it("throws if SESSION_SECRET is too short", () => {
    process.env.SESSION_SECRET = "shorty";
    expect(() => signSessionId("abc")).toThrow(/SESSION_SECRET/);
  });
});

describe("session cookie serialisation", () => {
  it("uses the __Host- prefix, HttpOnly, Secure, SameSite=Lax, Path=/", () => {
    const cookie = serialiseSessionCookie("signed-value");
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=signed-value`);
    expect(SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  it("can drop Secure in dev (insecure: true)", () => {
    const cookie = serialiseSessionCookie("signed-value", { insecure: true });
    expect(cookie).not.toContain("Secure");
  });

  it("produces a Max-Age=0 cookie for logout", () => {
    const cookie = serialiseSessionLogoutCookie();
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
  });
});

describe("readSessionCookieFromHeader", () => {
  it("extracts the session cookie value out of a Cookie header", () => {
    const header = `foo=bar; ${SESSION_COOKIE_NAME}=abc-123.sig; baz=qux`;
    expect(readSessionCookieFromHeader(header)).toBe("abc-123.sig");
  });

  it("returns null when the cookie is absent", () => {
    expect(readSessionCookieFromHeader("foo=bar; baz=qux")).toBeNull();
    expect(readSessionCookieFromHeader(null)).toBeNull();
    expect(readSessionCookieFromHeader("")).toBeNull();
  });
});
