import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env", override: false });

async function main() {
  const limit = Number.parseInt(process.argv[2] ?? "3", 10);
  const delay = Number.parseInt(process.argv[3] ?? "0", 10);
  const { runClassify } = await import("@/lib/ai/run");
  console.log(`[smoke] limit=${limit} delayBetweenMs=${delay}`);
  const summary = await runClassify({ limit, delayBetweenMs: delay });
  console.log("[smoke] Summary:", JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] Failed:", err);
  process.exit(1);
});
