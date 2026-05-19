import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
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
    // Note: there used to be a `summary text` column here that mirrored
    // the raw RSS description. It was dropped in migration 0010
    // (Phase 8.G) because nobody read it — the LLM-generated
    // translations (`summary_es` / `summary_en`) live below and the
    // raw text the classifier consumes is in `raw_excerpt`.
    summaryEs: text("summary_es"),
    summaryEn: text("summary_en"),
    rawExcerpt: text("raw_excerpt"),
    imageUrl: text("image_url"),
    language: languageEnum("language").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    status: articleStatusEnum("status").notNull().default("pending"),
    classificationError: text("classification_error"),
    // LLM-emitted "is this worth surfacing" signal in [0, 1]. Persisted from
    // Phase 8.A onward so the broadcaster can filter to high-relevance
    // articles. NULL for any article classified before that migration ran —
    // those stay out of broadcast naturally and never flood the channels
    // with backlog.
    relevanceScore: real("relevance_score"),
    // Phase 8.D traceability: which cron tick first inserted this row
    // (set by the ingest job) and which tick produced its current
    // classification (set by classify; rewritten on reclassify). Both
    // nullable for back-compat with rows that pre-date the migration —
    // those just show up without a "run" badge in the admin detail
    // view. ON DELETE SET NULL so pruning old cron_runs (if we ever
    // add a retention job) doesn't take articles down with them.
    ingestedInRun: uuid("ingested_in_run").references(() => cronRuns.id, {
      onDelete: "set null",
    }),
    classifiedInRun: uuid("classified_in_run").references(() => cronRuns.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("articles_url_hash_unique").on(t.urlHash),
    index("articles_published_at_idx").on(t.publishedAt.desc()),
    index("articles_status_idx").on(t.status),
    index("articles_category_id_idx").on(t.categoryId),
    // Used by the admin cron-run detail view to fetch "what did this
    // tick ingest/classify?" without a sequential scan of the table.
    index("articles_ingested_in_run_idx").on(t.ingestedInRun),
    index("articles_classified_in_run_idx").on(t.classifiedInRun),
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
    // Bcrypt hash of the password. NULL means the user hasn't bootstrapped
    // a password yet — login is impossible until they go through "forgot
    // password" (which sends a one-time reset link via Resend). This is the
    // path for both initial admin and admin-added users.
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

// Password-reset tokens. Same shape as the deprecated `magic_link_tokens`
// (sha256 hex digest, single-use, time-bounded) but a different purpose:
// these gate the `/admin/reset-password` page only — they never grant a
// session directly. After consumption, the user picks a new password and
// then logs in normally via email + password.
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    index("password_reset_tokens_user_id_idx").on(t.userId),
    uniqueIndex("password_reset_tokens_token_hash_unique").on(t.tokenHash),
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

export const cronJobEnum = pgEnum("cron_job", [
  "ingest",
  "classify",
  "broadcast",
  "newsletter",
  // Phase 8.F: daily hard-delete of failed + hidden articles older
  // than the retention window. Keeps the DB from growing unbounded
  // with classifier mis-fires (non_ai), duplicates and LLM errors.
  // See `lib/cleanup/run.ts`.
  "cleanup",
]);
// `running` is the in-progress placeholder: row is inserted at the top
// of every cron handler so child writes (article inserts/updates,
// broadcast records) can reference the FK while the loop is still
// going. At the end of the handler the status is flipped to one of
// `ok` / `partial` / `failed`. A row stuck in `running` means the
// handler crashed mid-tick (rare, but the admin UI can flag it).
export const cronStatusEnum = pgEnum("cron_run_status", ["running", "ok", "partial", "failed"]);

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
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type CronRun = typeof cronRuns.$inferSelect;
export type NewCronRun = typeof cronRuns.$inferInsert;
export type CronJob = (typeof cronJobEnum.enumValues)[number];
export type CronRunStatus = (typeof cronStatusEnum.enumValues)[number];
export type ArticleStatus = (typeof articleStatusEnum.enumValues)[number];
export type UserType = (typeof userTypeEnum.enumValues)[number];
/** Locale stored alongside an article / subscriber. Matches `i18n/routing.ts`. */
export type Locale = (typeof languageEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// Broadcast distribution (Phase 8.A)
// ---------------------------------------------------------------------------

/**
 * Platforms the broadcaster bot posts to. Tracked per (article, platform)
 * so a Mastodon outage doesn't permanently block Bluesky/Telegram for the
 * same article — each platform is its own idempotency boundary.
 */
export const broadcastPlatformEnum = pgEnum("broadcast_platform", [
  "mastodon",
  "bluesky",
  "telegram",
]);

export const articleBroadcasts = pgTable(
  "article_broadcasts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    platform: broadcastPlatformEnum("platform").notNull(),
    /** When the platform accepted the post (server-side wall-clock). */
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Provider-side id (Mastodon status id, Bluesky AT-URI, Telegram
     * message id as text). Optional — kept for traceability and for a
     * future "delete from platform" admin action.
     */
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Phase 8.D traceability: cron tick that produced this broadcast.
    // Nullable for back-compat with rows from before the migration.
    cronRunId: uuid("cron_run_id").references(() => cronRuns.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    // The unique index is the idempotency contract: at most one row per
    // (article, platform). The orchestrator relies on a clean INSERT here
    // failing with a unique violation if a parallel tick races us.
    uniqueIndex("article_broadcasts_article_platform_unique").on(t.articleId, t.platform),
    index("article_broadcasts_platform_posted_at_idx").on(t.platform, t.postedAt.desc()),
    // Powers the admin cron-run detail view: "what did this broadcast
    // tick post?" without scanning the whole table.
    index("article_broadcasts_cron_run_id_idx").on(t.cronRunId),
  ],
);

export type ArticleBroadcast = typeof articleBroadcasts.$inferSelect;
export type NewArticleBroadcast = typeof articleBroadcasts.$inferInsert;
export type BroadcastPlatform = (typeof broadcastPlatformEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// Newsletter subscribers (Phase 8.C.2)
// ---------------------------------------------------------------------------

/**
 * Newsletter mailing list. Double opt-in: a subscriber is "active" only
 * once `confirmed_at` is set AND `unsubscribed_at` is NULL. The two token
 * hashes are sha256 of the plaintext tokens delivered by email; the
 * plaintext is never stored, so a DB leak does not let an attacker
 * confirm or unsubscribe other people's emails.
 *
 * Same approach as `password_reset_tokens`: store the digest, compare via
 * the helper in `lib/newsletter/tokens.ts`.
 */
export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Stored lowercase + trim. The query layer normalises before any
    // insert/select so DB-level uniqueness is meaningful.
    email: text("email").notNull(),
    /**
     * Locale preference at signup time. Drives which language the weekly
     * digest renders in. Defaults to ES which is the project's default
     * locale; the subscribe endpoint passes through the request's locale.
     */
    locale: languageEnum("locale").notNull().default("es"),
    /**
     * sha256 digest of the confirmation token. Cleared (set to NULL) on
     * confirmation so the link cannot be reused, and so a re-subscribe
     * issues a fresh token.
     */
    confirmTokenHash: text("confirm_token_hash"),
    /**
     * Plaintext unsubscribe token, stable for the lifetime of the
     * subscription. Embedded in every weekly digest so the recipient always
     * has a one-click way out. NOT hashed: the digest cron needs to put the
     * literal token in every email, and there's no authentication value
     * worth defending here (the worst-case is "an attacker with full DB
     * read can unsubscribe other people from a free newsletter").
     */
    unsubscribeToken: text("unsubscribe_token").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("newsletter_subscribers_email_unique").on(t.email),
    uniqueIndex("newsletter_subscribers_unsubscribe_token_unique").on(t.unsubscribeToken),
    index("newsletter_subscribers_confirm_token_idx").on(t.confirmTokenHash),
  ],
);

export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;
export type NewNewsletterSubscriber = typeof newsletterSubscribers.$inferInsert;

// ---------------------------------------------------------------------------
// Newsletter sends + open tracking (Phase 8.E)
// ---------------------------------------------------------------------------

/**
 * One row per (subscriber, weekly digest tick). Powers two things in
 * the admin panel:
 *
 *   1. Per-subscriber delivery history — "has Alice received the last
 *      three digests, or did Resend bounce one of them?".
 *   2. Open tracking via a 1x1 transparent pixel hosted at
 *      `/api/track/open?id=<send_id>`. The first GET sets
 *      `opened_at`; subsequent loads are no-ops (idempotent).
 *
 * Privacy: the email's footer carries a one-line notice telling the
 * recipient that opens are measured. Apple Mail Privacy (and similar
 * pre-fetchers) inflate the open rate, so we use it as a directional
 * signal — never as a deliverability gate.
 *
 * `cron_run_id` is the FK back to the broadcast tick that produced
 * the send, mirroring `article_broadcasts` (Phase 8.D). Nullable
 * because a future ad-hoc resend from /admin might not have a cron
 * tick to attribute.
 */
export const newsletterSends = pgTable(
  "newsletter_sends",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => newsletterSubscribers.id, { onDelete: "cascade" }),
    cronRunId: uuid("cron_run_id").references(() => cronRuns.id, {
      onDelete: "set null",
    }),
    /** When we handed the email to Resend (server-side wall-clock). */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    /** Resend message id, returned by their HTTP API. Optional for back-compat with manual replays. */
    resendId: text("resend_id"),
    /**
     * First open timestamp, set by `/api/track/open` the first time
     * the pixel is fetched. NULL until then. Updates are
     * `WHERE opened_at IS NULL` so a re-open doesn't overwrite the
     * first one — that's the metric most providers report.
     */
    openedAt: timestamp("opened_at", { withTimezone: true }),
  },
  (t) => [
    index("newsletter_sends_subscriber_id_idx").on(t.subscriberId),
    index("newsletter_sends_cron_run_id_idx").on(t.cronRunId),
    index("newsletter_sends_sent_at_desc_idx").on(t.sentAt.desc()),
  ],
);

export type NewsletterSend = typeof newsletterSends.$inferSelect;
export type NewNewsletterSend = typeof newsletterSends.$inferInsert;
