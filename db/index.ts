import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.NODE_ENV !== "test") {
  // eslint-disable-next-line no-console
  console.warn("[db] DATABASE_URL is not set. Queries will fail at runtime.");
}

// Lazy client. Avoid throwing at import time so build/typecheck succeed
// without secrets present.
const client = connectionString ? postgres(connectionString, { prepare: false }) : undefined;

export const db = client
  ? drizzle(client, { schema })
  : (undefined as unknown as ReturnType<typeof drizzle>);
