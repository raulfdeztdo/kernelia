import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import esMessages from "@/messages/es.json";
import enMessages from "@/messages/en.json";

describe("i18n configuration", () => {
  it("declares es and en as supported locales", () => {
    expect(routing.locales).toEqual(["es", "en"]);
  });

  it("uses es as default locale", () => {
    expect(routing.defaultLocale).toBe("es");
  });

  it("has matching key trees in es and en message files", () => {
    expect(collectKeys(esMessages)).toEqual(collectKeys(enMessages));
  });
});

function collectKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [];
  return Object.entries(obj)
    .flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "object" && value !== null) return collectKeys(value, path);
      return [path];
    })
    .sort();
}
