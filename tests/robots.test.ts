import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { BLOCKED_BOTS } from "@/lib/robots";

describe("robots", () => {
  const { rules } = robots();
  const groups = Array.isArray(rules) ? rules : [rules];

  it("shuts the listed bots out of the whole site", () => {
    const blocked = groups.find((g) => g.userAgent !== "*");
    expect(blocked?.disallow).toBe("/");
    expect(blocked?.userAgent).toEqual([...BLOCKED_BOTS]);
  });

  it("keeps search engines allowed under the catch-all group", () => {
    const all = groups.find((g) => g.userAgent === "*");
    expect(all?.allow).toBe("/");
    expect(BLOCKED_BOTS).not.toContain("Googlebot");
    expect(BLOCKED_BOTS).not.toContain("bingbot");
  });

  it("blocks AI training crawlers but not AI search agents", () => {
    for (const bot of ["GPTBot", "CCBot", "ClaudeBot", "meta-externalagent"]) {
      expect(BLOCKED_BOTS).toContain(bot);
    }
    for (const bot of ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Claude-SearchBot"]) {
      expect(BLOCKED_BOTS).not.toContain(bot);
    }
  });
});
