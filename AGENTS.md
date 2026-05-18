# AGENTS.md

This file is the canonical entry point for every AI coding agent that
works on Kernelia (opencode, Claude Code, Cursor, etc.). opencode and
Claude Code load it automatically as system context; treat what's
below as binding for any session that lands here.

## 1. What is Kernelia

Public bilingual (ES/EN) AI-news aggregator. RSS feeds are ingested
every 3h; pending articles are classified by an LLM into a fixed
taxonomy and translated/summarised in both languages, then served via
a Next.js App Router home page with category filters, search, RSS,
and SEO metadata per locale.

Two surfaces:

- **Public feed** (`/[locale]`, `/api/articles`, `rss.xml`,
  `sitemap.xml`, `robots.txt`) — no auth, free read.
- **Admin backoffice** (`/admin/*`, `/api/admin/*`) — auth required
  (email + bcrypt password, HMAC-signed cookie session; Resend powers
  password reset only). `noindex, nofollow`, excluded from sitemap.
  Operator-only.

Production: <https://kernelia.dev>

## 2. Stack at a glance

- **Runtime:** Node 22 LTS, TypeScript strict, pnpm.
- **Framework:** Next.js 15 App Router with `[locale]` segment (next-intl).
- **DB:** Supabase Postgres via Drizzle ORM + `postgres` driver (pool `max: 1`).
- **LLM:** Cerebras `llama3.1-8b` via the OpenAI-compatible SDK.
- **UI:** Tailwind v4 + shadcn/ui + Lucide icons.
- **Cron:** GitHub Actions hits `/api/cron/{ingest,classify}` with `CRON_SECRET`.
- **Hosting:** Vercel Hobby (60s function cap). Free-tier across the board.

Full stack rationale and folder conventions in `context-docs/coding-principles.md`.

## 3. Non-negotiable rules (read fully in `context-docs/non-negotiable.md`)

The full list is in that file and takes precedence over anything else.
The high-impact ones:

- **No direct commits to `main`.** PR + `code-review-agent` APPROVE required.
- **TypeScript strict.** `any`, `@ts-ignore`, `as unknown as` are banned without written justification in the PR.
- **No DB access from UI.** UI → `db/queries/*` only.
- **No domain logic in components.** LLM and ingest code stays in `lib/ai/` and `lib/ingest/`.
- **No hardcoded UI strings.** Every new key exists in both `messages/es.json` and `messages/en.json` in the same commit.
- **Validate LLM output with Zod before persisting.** Never store unvalidated output.
- **No `.skip` / `.only`** in committed tests.
- **Structural changes** update `context-docs/coding-principles.md` and `PLAN.md` in the same PR.

## 4. Agent registry

The project workflow is split across four agents. Their contracts
live in `.agents/` (verbose, human-readable) and are mirrored as
opencode-native subagents in `.opencode/agent/` so opencode can
invoke them directly.

| Agent | Full contract | When it enters | Output |
|---|---|---|---|
| `arch-agent` | `.agents/arch-agent.md` | New feature, stack change, or structural decision | DD(s) + task breakdown + canonical branch |
| `backend-agent` | `.agents/backend-agent.md` | Backend task (ingest, AI, API route, schema) | Implementation on the canonical branch, with tests |
| `frontend-agent` | `.agents/frontend-agent.md` | UI / i18n / filter / search / page task | Implementation + visual parity check |
| `code-review-agent` | `.agents/code-review-agent.md` | Canonical branch ready for merge gate | `APPROVE` or `BLOCK` with evidence |

There is no separate `pm-agent`, `tech-agent`, `setup-agent`,
`design-agent`, or `devops-agent`. Those responsibilities are
absorbed:

- Product priorities → human operator + `PLAN.md`.
- Setup / DX → `arch-agent` during its initial phase.
- Visual design → `modern-ui-design` skill + shadcn/ui defaults.
- Release → PR merge → Vercel auto-deploy.

## 5. Standard workflow

```
HU/FR approved
      ↓
arch-agent       → DD(s), task list, canonical branch name
      ↓
backend-agent  ⟂  frontend-agent     ← parallel where possible
      ↓             ↓                  ← worktree-per-task
       \           /
        canonical branch
              ↓
       code-review-agent → APPROVE | BLOCK
              ↓ APPROVE
            PR → main
              ↓
         Vercel auto-deploy
```

## 6. File map

| Path | What lives there |
|---|---|
| `app/[locale]/` | Public pages with locale segment (home, about). Server components by default. |
| `app/admin/` | Admin backoffice (Fase 7). No locale segment, ES copy, `noindex,nofollow`. Requires session. |
| `app/api/` | Route handlers: `cron/{ingest,classify}`, `articles`, `health`, `rss.xml`. |
| `app/api/admin/` | Admin endpoints: `login`, `logout`, `forgot-password`, `reset-password`, `articles/*`, `users/*`. |
| `app/api/cron/` | Cron endpoints: `ingest`, `classify`, `broadcast`. Bearer-auth via `CRON_SECRET`. |
| `components/` | UI; `components/ui/` is shadcn primitives. |
| `lib/ai/` | Cerebras client, prompts, Zod schemas, `classifyArticle`, `runClassify`. |
| `lib/ingest/` | RSS parser, dedupe, normalisation. |
| `lib/broadcast/` | Auto-publication to Mastodon + Bluesky + Telegram. Per-platform clients + orchestrator + text formatter. Server-only. |
| `lib/auth/` | Password hashing (bcrypt), password-reset tokens, HMAC-signed session cookie, in-memory rate-limit. Server-only. |
| `lib/email/` | Minimal Resend wrapper (`sendPasswordReset`). |
| `db/` | Drizzle schema, migrations, queries. `db/queries/*` is the only DB surface. |
| `db/queries/` | All SQL-touching code. UI imports from here, never from `db/index.ts`. |
| `messages/` | `es.json`, `en.json` — every UI string of the public site. |
| `context-docs/` | Canonical rules (this is the source of truth, not the README). |
| `.agents/` | Full agent contracts (verbose, human-oriented). |
| `.opencode/agent/` | opencode-native subagent definitions (thin shims that point back to `.agents/`). |
| `.agents/skills/` | Reusable skill modules referenced by agent frontmatter. |
| `tests/` | Vitest unit; Playwright e2e under `e2e/`. |
| `PLAN.md` | Current phase and roadmap. Updated together with structural changes. |

## 7. Canonical commands

```bash
pnpm install           # bootstrap
pnpm dev               # local dev (Next 15)
pnpm lint              # ESLint (Next config) + Prettier check
pnpm typecheck         # tsc --noEmit
pnpm test              # Vitest unit
pnpm test:e2e          # Playwright e2e
pnpm build             # Next production build
pnpm db:generate       # generate migrations from drizzle schema
pnpm db:migrate        # apply migrations
pnpm db:studio         # local Drizzle studio
```

CI runs `lint + typecheck + test + build` on every PR.

## 8. Agent frontmatter conventions

Each `.agents/*.md` carries the same YAML shape:

- `name`: stable identifier referenced elsewhere.
- `description`: when this agent enters and what it outputs.
- `model`: provider/model id (e.g. `anthropic/claude-sonnet-4-5`); leave unset to inherit the session model.
- `tools`: object form per opencode spec (`{ read: true, edit: true, ... }`).
- `required_skills`: skills the agent loads on every run.
- `optional_skills`: skills it may pull in based on the task.
- `mcp_usage`: MCP servers it expects to call.

The mirrored `.opencode/agent/*.md` files use the same shape and rely
on `opencode.jsonc`'s `instructions` array to make the full `.agents/`
contract and `context-docs/` rules part of every session's context.

## 9. opencode config bootstrap

The repo ships **`opencode.example.jsonc`** as a template. On a fresh
clone, copy it once:

```bash
cp opencode.example.jsonc opencode.jsonc
```

opencode reads `opencode.jsonc` (and `opencode.json` if present);
both are gitignored. The template has zero secrets — your personal
`opencode.jsonc` is where MCP keys and model overrides live. Never
put API keys back into the `.example.jsonc` — that file is the one
that ends up in git history forever.
