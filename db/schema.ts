import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const languageEnum = pgEnum("language", ["es", "en"]);

// `hidden` is a human decision (admin chose to suppress), distinct from
// `failed` (LLM error). Public queries already filter `status='classified'`
// so hidden articles drop out of the feed/RSS/sitemap automatically.
export const articleStatusEnum = pgEnum("article_status", [
  "pending",
  "classified",
  "failed",
  "hidden",
]);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    url: text("url").notNull(),
    rssUrl: text("rss_url").notNull(),
    language: languageEnum("language").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sources_rss_url_unique").on(t.rssUrl)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").notNull(),
    nameEs: text("name_es").notNull(),
    nameEn: text("name_en").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("categories_slug_unique").on(t.slug)],
);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    urlHash: text("url_hash").notNull(),
    title: text("title").notNull(),
    titleEs: text("title_es"),
    titleEn: text("title_en"),
    summary: text("summary"),
    summaryEs: text("summary_es"),
    summaryEn: text("summary_en"),
    rawExcerpt: text("raw_excerpt"),
    imageUrl: text("image_url"),
    language: languageEnum("language").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    status: articleStatusEnum("status").notNull().default("pending"),
    classificationError: text("classification_error"),
  },
  (t) => [
    uniqueIndex("articles_url_hash_unique").on(t.urlHash),
    index("articles_published_at_idx").on(t.publishedAt.desc()),
    index("articles_status_idx").on(t.status),
    index("articles_category_id_idx").on(t.categoryId),
  ],
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;

// ---------------------------------------------------------------------------
// Admin backoffice (Phase 7)
// ---------------------------------------------------------------------------

// `user_type` left extensible: today only `admin`, but adding new values
// later (`editor`, `viewer`) is a one-line ALTER TYPE without migrating
// the column from string to enum.
export const userTypeEnum = pgEnum("user_type", ["admin"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Stored lowercase + trim. Normalisation happens at the query layer
    // before any insert/select so DB-level uniqueness is meaningful.
    email: text("email").notNull(),
    userType: userTypeEnum("user_type").notNull().default("admin"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // sha256 hex digest of the plaintext token. Never store plaintext.
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    index("magic_link_tokens_user_id_idx").on(t.userId),
    uniqueIndex("magic_link_tokens_token_hash_unique").on(t.tokenHash),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const cronJobEnum = pgEnum("cron_job", ["ingest", "classify"]);
export const cronStatusEnum = pgEnum("cron_run_status", ["ok", "partial", "failed"]);

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    job: cronJobEnum("job").notNull(),
    status: cronStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    // Free-form JSON: keeps the schema stable when run summaries evolve.
    // classify: processed/classified/failed/timedOut/budgetExhausted/tokens
    // ingest: feedsAttempted/articlesInserted/errors
    summary: jsonb("summary").notNull(),
    errorMessage: text("error_message"),
  },
  (t) => [index("cron_runs_started_at_desc_idx").on(t.startedAt.desc())],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type MagicLinkToken = typeof magicLinkTokens.$inferSelect;
export type NewMagicLinkToken = typeof magicLinkTokens.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type CronRun = typeof cronRuns.$inferSelect;
export type NewCronRun = typeof cronRuns.$inferInsert;
export type CronJob = (typeof cronJobEnum.enumValues)[number];
export type CronRunStatus = (typeof cronStatusEnum.enumValues)[number];
export type ArticleStatus = (typeof articleStatusEnum.enumValues)[number];
export type UserType = (typeof userTypeEnum.enumValues)[number];
