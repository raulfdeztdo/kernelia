import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSiteUrl, localeAlternates, localizedUrl } from "@/lib/site";

describe("getSiteUrl", () => {
  const ORIG_PUBLIC = process.env.NEXT_PUBLIC_SITE_URL;
  const ORIG_VERCEL = process.env.VERCEL_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    if (ORIG_PUBLIC !== undefined) process.env.NEXT_PUBLIC_SITE_URL = ORIG_PUBLIC;
    if (ORIG_VERCEL !== undefined) process.env.VERCEL_URL = ORIG_VERCEL;
  });

  it("prefers NEXT_PUBLIC_SITE_URL and strips a trailing slash", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://kernelia.app/";
    expect(getSiteUrl()).toBe("https://kernelia.app");
  });

  it("falls back to VERCEL_URL with https prefix", () => {
    process.env.VERCEL_URL = "kernelia-foo.vercel.app";
    expect(getSiteUrl()).toBe("https://kernelia-foo.vercel.app");
  });

  it("uses localhost when no env vars are set", () => {
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});

describe("localizedUrl", () => {
  const ORIG = process.env.NEXT_PUBLIC_SITE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://kernelia.app";
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = ORIG;
  });

  it("returns origin for default locale + root", () => {
    expect(localizedUrl("es", "/")).toBe("https://kernelia.app");
  });

  it("prefixes the non-default locale", () => {
    expect(localizedUrl("en", "/")).toBe("https://kernelia.app/en");
  });

  it("appends path for default locale", () => {
    expect(localizedUrl("es", "/about")).toBe("https://kernelia.app/about");
  });

  it("appends path for non-default locale", () => {
    expect(localizedUrl("en", "/about")).toBe("https://kernelia.app/en/about");
  });

  it("normalizes paths missing a leading slash", () => {
    expect(localizedUrl("es", "about")).toBe("https://kernelia.app/about");
  });
});

describe("localeAlternates", () => {
  const ORIG = process.env.NEXT_PUBLIC_SITE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://kernelia.app";
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = ORIG;
  });

  it("includes every locale plus x-default", () => {
    const alts = localeAlternates("/about");
    expect(alts).toEqual({
      es: "https://kernelia.app/about",
      en: "https://kernelia.app/en/about",
      "x-default": "https://kernelia.app/about",
    });
  });
});
