import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit no carga .env.local por defecto. Lo hacemos aqui.
config({ path: ".env.local" });
config({ path: ".env", override: false });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
