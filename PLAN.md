# PLAN.md — Kernelia

Estado vivo del plan de ejecucion. Se actualiza al cerrar cada fase con la fecha, el commit/PR de referencia y notas relevantes.

**Leyenda de estado:** `pending` · `in-progress` · `done` · `blocked`

---

## Resumen

Kernelia es un agregador de noticias sobre IA con clasificacion automatica via LLM. Web publica, sin auth, UI bilingue ES/EN. Stack: Next.js 15 + Supabase + Drizzle + Cerebras + Vercel. No es un MVP de descarte: se prueba en dev y se publica una `v0.1.0` como version inicial cuando este lista.

## Estado global

| # | Fase | Estado | Fecha cierre | Notas |
|---|------|--------|--------------|-------|
| 0 | Limpieza y rebranding del repo | **done** | 2026-05-13 | Eliminados 5 agentes y 16 skills. Docs reescritas para Kernelia. |
| 1 | Bootstrap del proyecto Next.js | **done** | 2026-05-13 | Next 15 + TS estricto + Tailwind v4 + next-intl ES/EN + Drizzle + Vitest + Playwright + CI. Build, lint, typecheck y tests verdes. |
| 2 | Modelo de datos e ingesta RSS | **done** | 2026-05-14 | Schema sources/categories/articles aplicado en Supabase. 10 fuentes seeded. Endpoint `/api/cron/ingest` con auth, 975 articulos pending tras smoke real. Dedupe verificado (segunda corrida = 0 inserts). |
| 3 | Agente IA (clasificacion + resumen) | **done** | 2026-05-14 | Cliente Cerebras (openai SDK) + Zod + prompt cerrado a 10 slugs. Endpoint `/api/cron/classify` con auth y param `limit`. Smoke real: 23/23 articulos clasificados, 0 failed, ~280ms latencia media, ~720 tokens/articulo. |
| 4 | Web: listado, filtros, busqueda, i18n | pending | — | — |
| 5 | Pulido, SEO, accesibilidad | pending | — | — |
| 6 | Release v0.1.0 a produccion | pending | — | — |

---

## Fase 0 — Limpieza y rebranding del repo · `done`

**Objetivo:** dejar el repo alineado con Kernelia y sin ceremonia de agentes/skills sobrante.

- [x] Eliminar `pm-agent`, `setup-agent`, `tech-agent`, `design-agent`, `devops-agent`.
- [x] Eliminar skills no usadas (16 skills: hexagonal, definiciones HU/FR/DD/TD/UD, glossary-management, product-discovery, seed-data, tdd-methodology, visual-parity-validation, zustand-state, database-prisma, backend-solid, browser-insights-review, task-manager, i18n queda).
- [x] Refinar skill `i18n` para next-intl + ES/EN.
- [x] Reescribir `README.md` con stack y estructura objetivo.
- [x] Reescribir `AGENTS.md` con los 4 agentes.
- [x] Reescribir `context-docs/coding-principles.md` para Kernelia.
- [x] Recortar `context-docs/non-negotiable.md`.
- [x] Eliminar `context-docs/glossary.md`.
- [x] Crear `.env.example`.
- [x] Actualizar `.gitignore` (node_modules, .next, .vercel, .env*).

---

## Fase 1 — Bootstrap del proyecto Next.js · `done`

**Objetivo:** Next.js corriendo en local con TypeScript estricto, Tailwind, shadcn, next-intl con ES/EN y deploy inicial en Vercel conectado a Supabase.

### Completado en local (2026-05-13)

- [x] Scaffold Next 15 manual (App Router + TS + Tailwind v4 + ESLint flat + Prettier).
- [x] `tsconfig.json` con `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- [x] Prettier + plugin tailwind + ESLint flat con reglas estrictas (`no-explicit-any`, `consistent-type-imports`).
- [x] **next-intl 3.26** con segmento `[locale]`, `es` default, `en`, `localePrefix: "as-needed"`, cookie `NEXT_LOCALE`.
- [x] `messages/es.json` y `messages/en.json` con keys de `metadata`, `header`, `home`, `footer`.
- [x] `LocaleSwitcher` cliente con `useTransition` y `router.replace`.
- [x] `components.json` de **shadcn/ui** (style new-york, base neutral) + `lib/utils.cn`.
- [x] **Drizzle** + `drizzle-kit` + driver `postgres`; `db/index.ts` lazy (no rompe sin env); `db/schema.ts` placeholder; `drizzle.config.ts`.
- [x] **Vitest** + jsdom + Testing Library + smoke test (`tests/smoke.test.ts`: keys ES y EN matchean, locales correctos).
- [x] **Playwright** + smoke e2e (`tests/e2e/home.spec.ts`: ES en `/`, EN en `/en`, cambio de locale).
- [x] GitHub Actions `.github/workflows/ci.yml`: lint + typecheck + test + build + e2e.

### Verificacion local

- `pnpm lint` ✔
- `pnpm typecheck` ✔
- `pnpm test` ✔ (3 tests)
- `pnpm build` ✔ (rutas `/es`, `/en`, middleware 47 kB)
- `pnpm dev` sirve `/` con `lang="es"` -> "Últimas noticias"; `/en` con `lang="en"` -> "Latest news".

### Pendiente con accion del usuario

- [ ] Crear proyecto Supabase y rellenar `.env.local` (DATABASE_URL, DATABASE_URL_DIRECT, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE).
- [ ] `pnpm db:push` para aplicar el schema vacio (validacion de conexion).
- [ ] Crear repo GitHub, primer push (`git init && git remote add origin ...`).
- [ ] Conectar repo a **Vercel** y verificar deploy bilingue.
- [ ] Anadir env vars al proyecto Vercel.

**Criterio de cierre:** preview de Vercel muestra home en ES y EN; CI verde en una PR de prueba.

---

## Fase 2 — Modelo de datos e ingesta RSS · `done`

**Objetivo:** schema en DB y job de ingesta que trae articulos sin clasificar.

### Completado (2026-05-14)

- [x] Schema Drizzle en `db/schema.ts`: `sources`, `categories`, `articles` (con enums `language` y `article_status`).
- [x] Migracion `drizzle/0000_tiresome_stature.sql` aplicada en Supabase via `pnpm db:migrate`.
- [x] Indices: `url_hash` unico, `published_at desc`, `status`, `category_id`.
- [x] Seed `db/seed-data.ts` con 10 categorias canonicas (llm, agents, research, products, robotics, policy, safety, multimodal, coding, other) y 10 fuentes RSS (TechCrunch, The Verge, MIT Tech Review, VentureBeat, Hugging Face, DeepMind, Ars Technica, Wired, Xataka, Genbeta).
- [x] `db/seed.ts` idempotente y autoritativo (borra fuentes que no estan en `seed-data`).
- [x] `lib/ingest/normalize.ts`: `canonicalizeUrl` (strip utm/fbclid/gclid, ordena params, normaliza host y slash), `plainTextExcerpt` (strip HTML + entities + truncado), `parseDate`.
- [x] `lib/ingest/dedupe.ts`: `urlHash = sha256(canonicalizeUrl(url))`.
- [x] `lib/ingest/rss.ts`: parser con timeout 15s, User-Agent propio, custom fields para content:encoded.
- [x] `lib/ingest/run.ts`: orquesta ingesta por fuente con captura de errores aislada.
- [x] `db/queries/{articles,sources}.ts`: insert con `onConflictDoNothing(urlHash)`.
- [x] `lib/auth/cron.ts`: validador de header `Authorization: Bearer ${CRON_SECRET}` con comparacion timing-safe.
- [x] `app/api/cron/ingest/route.ts`: GET/POST autenticado, runtime nodejs, maxDuration 60s, devuelve `IngestSummary`.
- [x] `lib/logger.ts`: JSON structured logger por scope.
- [x] Tests Vitest (`tests/ingest.test.ts`): 14 tests cubriendo canonicalizeUrl, urlHash, plainTextExcerpt, parseDate.
- [x] Scripts `db:seed`, `db:generate`, `db:migrate`, `db:push`, `db:studio` en `package.json`.
- [x] `db/inspect.ts` para verificacion manual del estado.

### Verificacion contra Supabase real

- Primer run: **967 fetched / 967 inserted** en 9.5s, 9/10 fuentes ok (Anthropic 404 -> reemplazada por VentureBeat).
- Segundo run (dedupe): **967 fetched / 0 inserted**.
- Tercer run tras swap: **974 fetched / 8 inserted**, 0 fuentes fallidas.
- Estado final DB: 10 categorias, 10 fuentes activas, 975 articulos en status `pending`.

### Verificacion local

- `pnpm lint` ✔
- `pnpm typecheck` ✔
- `pnpm test` ✔ (17 tests: 3 smoke + 14 ingest)
- `pnpm build` ✔ (rutas: `/[locale]`, `/api/cron/ingest`)

### Notas operativas

- `DATABASE_URL` usa transaction pooler (6543), `DATABASE_URL_DIRECT` usa session pooler (5432) por IPv6-only en la conexion directa de Supabase.
- `Hugging Face Blog` trae 777 articulos historicos en el primer feed (no es bug, su RSS lista todo).
- Endpoint protegido: sin header devuelve `401 unauthorized`; con `Bearer $CRON_SECRET` ejecuta y devuelve resumen JSON.

---

## Fase 3 — Agente IA (clasificacion + resumen) · `done`

**Objetivo:** procesar articulos `pending` y producir categoria + resumen validados.

### Completado (2026-05-14)

- [x] Cliente Cerebras en `lib/ai/client.ts` (SDK `openai@4.77` con `baseURL`, defaults `llama3.1-8b` y `https://api.cerebras.ai/v1`).
- [x] Schema Zod en `lib/ai/schemas.ts`: `{ category_slug, summary, language, relevance_score }` + lista cerrada de 10 slugs canonicos + JSON Schema espejo para fallback futuro.
- [x] Prompt cerrado en `lib/ai/prompts/classify-article.ts`: glosario por slug, JSON shape literal en el system prompt, reglas anti-marketing/anti-invento.
- [x] `classifyArticle()` con `response_format: { type: "json_object" }`, parse JSON + validacion Zod estricta.
- [x] Manejo de fallos: try/catch por articulo, `markArticleFailed(id, reason)` graba motivo (truncado 500 chars); el query `listPendingArticles` excluye los `failed` para no reintento automatico.
- [x] Route handler `app/api/cron/classify/route.ts` con `runtime nodejs`, `maxDuration 60`, query `?limit=N` (cap 50), header `Authorization: Bearer ${CRON_SECRET}`.
- [x] `lib/ai/run.ts`: orquesta batch con DI de cliente/fetcher/writers para tests; loguea por articulo (slug, latencia, tokens) y summary final con totales.
- [x] Tests Vitest (`tests/classify.test.ts`): 12 tests — schema (4), classifyArticle con cliente mock (4 happy/error paths), runClassify (3 escenarios: batch ok, JSON invalido, slug desconocido).

### Verificacion contra Cerebras + Supabase real

- Modelos disponibles en el tier del usuario: `llama3.1-8b`, `gpt-oss-120b`, `qwen-3-235b-a22b-instruct-2507`, `zai-glm-4.7`. El default `llama-3.3-70b` devolvia 404 — cambiado a `llama3.1-8b`.
- Smoke 1 (limit=3): 3 ok, latencia media 310ms, ~740 tokens/articulo.
- Smoke 2 (limit=20): 20 ok / 0 failed, 8.8s total, ~280ms/articulo, 14.4k tokens totales.
- Estado DB final: 23 classified, 0 failed, 952 pending.

### Verificacion local

- `pnpm lint` ✔
- `pnpm typecheck` ✔
- `pnpm test` ✔ (29 tests: 3 smoke + 14 ingest + 12 classify)
- `pnpm build` ✔ (rutas: `/[locale]`, `/api/cron/ingest`, `/api/cron/classify`)

### Notas operativas

- `CEREBRAS_MODEL` en `.env.example` ahora es `llama3.1-8b`. Para subir calidad: `gpt-oss-120b` o `qwen-3-235b-a22b-instruct-2507` (mismos endpoints).
- `response_format: json_schema` (strict) no esta soportado en este tier — usado `json_object` y dependencia en el prompt + Zod.
- Articulos `failed` NO se reintentan automaticamente. Script ad-hoc `db/reset-failed.ts` los vuelve a `pending` si fueron fallos de config.
- Smoke runner manual: `pnpm tsx db/smoke-classify.ts <limit>`.
- Fallback (Groq/Gemini) no implementado: pospuesto a si aparece rate-limit en produccion.

---

## Fase 4 — Web: listado, filtros, busqueda, i18n · `pending`

**Objetivo:** UI bilingue funcional y agradable.

- [ ] Layout `app/[locale]/layout.tsx` con header (titulo + selector idioma) y footer.
- [ ] Home `app/[locale]/page.tsx` (RSC): listado paginado por `published_at desc`.
- [ ] Componente `NewsCard` con: medio, categoria (badge), titulo, resumen, fecha relativa, link externo.
- [ ] Filtros por categoria (multi-select, server-side via search params).
- [ ] Input de busqueda con debounce (client) -> `?q=` server-side `ILIKE` sobre title y summary.
- [ ] Paginacion (cursor por `published_at` + `id`).
- [ ] Estados UI: skeleton, vacio, error.
- [ ] Responsive (mobile-first), modo oscuro automatico via Tailwind.
- [ ] Mensajes en `messages/es.json` y `messages/en.json` completos.
- [ ] Test E2E Playwright: cargar `/es`, filtrar por categoria, buscar termino, cambiar a `/en`.

**Criterio de cierre:** la web funciona en local con datos reales; filtros y busqueda devuelven resultados correctos; cambio de idioma preserva ruta.

---

## Fase 5 — Pulido, SEO, accesibilidad · `pending`

**Objetivo:** dejar la app presentable y observable antes de produccion.

- [ ] `generateMetadata` por locale (title, description, OG, canonical, alternates `hreflang`).
- [ ] `sitemap.ts` y `robots.ts` con ambos locales.
- [ ] Feed RSS propio (`/rss.xml`) opcional.
- [ ] Auditoria de accesibilidad basica (focus visible, contraste, `aria-*`).
- [ ] Lighthouse > 90 en performance/SEO/accesibilidad en preview.
- [ ] `vercel.json` con cron jobs (`ingest` cada 3h, `classify` cada 30min).
- [ ] Healthcheck `/api/health` (DB ping + ultima ingesta).
- [ ] Pagina `/about` bilingue con explicacion del proyecto y fuentes.

**Criterio de cierre:** auditoria pasada y crons configurados en Vercel preview.

---

## Fase 6 — Release v0.1.0 a produccion · `pending`

**Objetivo:** publicar version inicial estable.

- [ ] Smoke test en preview con datos reales durante 48h.
- [ ] Verificar que el cron en Vercel ejecuta y la DB se mantiene saludable.
- [ ] Tag `v0.1.0` y release notes en GitHub.
- [ ] Merge a `main` -> deploy en dominio de produccion (Vercel free).
- [ ] Comprobar metadata, robots, sitemap en produccion.
- [ ] Anuncio (opcional).

**Criterio de cierre:** dominio publico sirviendo articulos clasificados al dia, en ES y EN.

---

## Notas

- Cada fase abre una rama canonica (`feature/phase-N-...`) y se cierra con PR a `main`.
- Al cerrar una fase: actualizar tabla de estado, marcar checkboxes, anadir notas con commit/PR ref.
- Si una fase necesita dividirse, anadir subtarea en la fase correspondiente, no crear fases nuevas.
