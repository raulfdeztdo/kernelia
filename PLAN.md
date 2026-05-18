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
| 4 | Web: listado, filtros, busqueda, i18n | **done** | 2026-05-14 | UI bilingue real (titulos+resumenes en ES y EN almacenados por articulo). Card con filo lateral por categoria, imagen, fuente, fecha relativa. Filtros, busqueda con debounce, paginacion cursor. Cerebras free tier protegido con delay configurable. |
| 5 | Pulido, SEO, accesibilidad | **done** | 2026-05-14 | Metadata por locale (OG, canonical, hreflang+x-default). `sitemap.ts`, `robots.ts`, RSS `/rss.xml?lang=es|en`. Pagina `/about` bilingue con fuentes en vivo. `/api/health` con ping DB + counts. Cron via GitHub Actions (Vercel Hobby restringe a 1/dia). Skip-link, focus-visible global y `prefers-reduced-motion`. |
| 6 | Release v0.1.0 a produccion | **done** | 2026-05-14 | Dominio kernelia.dev con SSL, brand logo, paginacion append-style, cap por fuente=10, cola de clasificacion round-robin, cron en GHA verde, SEO consistente en produccion (canonical/og/robots/sitemap/RSS apuntan a kernelia.dev). `v0.1.0` taggeado y publicado. |
| 7 | Backoffice admin (auth + panel) | **done** | 2026-05-15 | Cinco sub-fases (7.A→7.E) entregadas en PRs separados (#19 schema+auth backend, #20 login UI, #21 dashboard+cron monitor, #22 gestion de articulos, #23 gestion de usuarios). Login `/admin` por magic-link (Resend, dominio kernelia.dev verificado, rate-limit 5/10min IP+email), cookie `__Host-` HMAC, session TTL 7d. Panel con metricas de articulos/categorias/fuentes/tokens, monitor `/admin/cron` ultimas 50 ejecuciones, gestion de articulos con guard de 5-columnas para `→ classified`, `hidden` distinto de `failed`, re-clasificar one-click, gestion de usuarios con guardrails (no self-target, never zero active admins). Audit via `console.log` estructurado. `/admin/*` excluido de sitemap/robots/middleware i18n. Posteriormente extendido en 7.F-H (PRs #24-26) con login por contrasenya+bcrypt, sidebar+health card, y 4 graficas Recharts en el dashboard. |
| 8 | Distribucion y propagacion del portal | **pending** | — | Suite completa de distribucion sin exigir presencia personal en redes. Tres sub-fases: 8.A broadcaster bot multiplataforma (Mastodon + Bluesky + Telegram, espanol, filtro `relevance_score >= 0.75`); 8.B share-buttons en cards publicas + `/about` ampliada con badges de RSS; 8.C newsletter opt-in semanal via Resend + endpoint `/api/stats` publico para transparencia. La marca habla, el operador no. |

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

## Fase 4 — Web: listado, filtros, busqueda, i18n · `done`

**Objetivo:** UI bilingue funcional y agradable.

### Completado (2026-05-14)

- [x] Schema: columna `image_url TEXT` en `articles` (migracion `0001_normal_squadron_supreme.sql`) aplicada en Supabase.
- [x] Extraccion de imagen en RSS (`lib/ingest/rss.ts`): enclosure tipo image, `media:content`, `media:thumbnail`, `<image>`, fallback al primer `<img>` en `content:encoded`/`description`. Helper `extractFirstImage` en `lib/ingest/normalize.ts`.
- [x] Script `db/backfill-images.ts` que re-parsea los feeds y rellena `image_url` de filas existentes con NULL.
- [x] Theme propio en `app/globals.css`: dark por defecto, acentos OKLCH por categoria (10 colores), gradientes ambientales, utilidades `line-clamp-2/3` y `card-hover`.
- [x] `components/header.tsx`: sticky, logo sparkles, tagline, search box centrado, locale switcher; `components/footer.tsx` con creditos + año dinamico.
- [x] `components/search-box.tsx` (client): debounce 350ms -> `router.replace(?q=)`, sync con URL externo via `useEffect`, `useTransition`.
- [x] `components/category-filter.tsx` (client): chip "Todas" + 10 chips con conteo (facets), multi-select via `category=a,b,c`, accent backgrund por categoria activa.
- [x] `components/news-card.tsx`: aspect 16/9 con imagen lazy (referrerPolicy no-referrer) o placeholder con gradiente del acento de su categoria + icono sparkles; badge de categoria flotante; tipografia con line-clamp.
- [x] `app/[locale]/page.tsx`: RSC con `searchParams`, ejecuta `listClassifiedArticles` + `getCategoryFacets` en paralelo, paginacion cursor por `(publishedAt, id)`, estados error/empty/results.
- [x] `db/queries/articles.ts`: `listClassifiedArticles(params)` con filtros, busqueda `ILIKE` sobre title+summary, cursor keyset; `getCategoryFacets()` para conteo por slug.
- [x] `lib/categories.ts` (parse + helpers) y `lib/format.ts` (relative time bilingue con `Intl.RelativeTimeFormat`).
- [x] `messages/{es,en}.json` con keys completas: metadata, header (tagline, search, language), home (heading, subheading, allCategories, resultsCount con plural ICU, loadMore, noResults, error), card, categories (10 slugs), footer (tagline, source, rights).
- [x] `tests/e2e/home.spec.ts`: home ES, home EN, switch locale, click chip "Agentes" -> URL contiene `category=agents`, escribir en search -> URL contiene `q=`.
- [x] Rate-limit hook en `lib/ai/run.ts`: opcion `delayBetweenMs` (default 0); el cron de classify usa **3000ms** (~20 RPM) tras observar 429s a 2s en el free tier de Cerebras.
- [x] Bilingue real: nuevas columnas `title_es`, `title_en`, `summary_es`, `summary_en` (migracion `0002`). El LLM devuelve los 4 campos en cada llamada; `listClassifiedArticles(locale)` selecciona el titulo/resumen del idioma activo via `coalesce(title_<loc>, title)`. La cuasi totalidad de articulos sale en EN del feed; el agente traduce el titulo y genera el resumen fresco en cada idioma.
- [x] Diseno final de tarjeta: filo de 3px en el lateral izquierdo con color de categoria (en vez de franja superior y badge sobre la imagen). Imagen 16:9 limpia, fila inicial con dot+nombre de categoria en minimalismo, titulo, resumen, y al pie fuente + fecha relativa. Sobrio.
- [x] `relevance_score` con `z.coerce.number()` para aguantar respuestas LLM que lo devuelven como string.

### Verificacion contra Supabase real

- Backfill de imagenes: **168/975 articulos** con `image_url` poblada (Verge, MIT, Wired, Xataka, Genbeta exponen media:content/enclosure). Hugging Face Blog no aporta imagenes en RSS (777 articulos sin imagen) — el UI muestra placeholder con gradiente.
- Smoke real `classify` con `delayBetweenMs=2000`: 50 articulos clasificados sin errores ni rate-limit (tiempo ~100s).
- Dev server smoke (`curl` a `/`, `/en`, `/?category=agents`, `/?q=openai`): home renderiza heading correcto por locale, chips muestran `aria-pressed=true` al filtrar, query string se respeta.

### Verificacion local

- `pnpm lint` ✔
- `pnpm typecheck` ✔
- `pnpm test` ✔ (29 tests: 3 smoke + 14 ingest + 12 classify)
- `pnpm build` ✔ (`/[locale]` 15.4 kB, `/api/cron/{ingest,classify}` registradas)

### Notas operativas

- Las imagenes se sirven con `<img>` plano (no `next/image`) para evitar configurar 10 `remotePatterns` y consumo de optimizaciones en Vercel. `loading="lazy"` + `referrerPolicy="no-referrer"`.
- Articulos sin imagen reciben un placeholder con gradiente derivado del color de su categoria — no rompe la maqueta.
- El home solo muestra `status='classified'`. Los `pending` siguen invisibles hasta que el cron los procese.
- Cerebras free tier (`llama3.1-8b`): ~30 RPM. Con `delayBetweenMs=2000` y `limit=10` por tick, un cron cada 5min digiere ~120 articulos/hora — suficiente para ~3 ciclos completos de ingesta al dia.

---

## Fase 5 — Pulido, SEO, accesibilidad · `done`

**Objetivo:** dejar la app presentable y observable antes de produccion.

### Completado (2026-05-14)

- [x] `lib/site.ts`: resolve del origen publico (`NEXT_PUBLIC_SITE_URL` -> `VERCEL_URL` -> `localhost:3000`), `localizedUrl(locale, path)` y `localeAlternates(path)` (incluye `x-default`).
- [x] `app/[locale]/layout.tsx` -> `generateMetadata` con `metadataBase`, `title` template, `description`, OG (`type=website`, `siteName`, `locale`, `alternateLocale`), Twitter `summary_large_image`, `robots` (index/follow + googleBot), `alternates.canonical`, `alternates.languages` y `alternates.types['application/rss+xml']`.
- [x] `app/[locale]/page.tsx` y `app/[locale]/about/page.tsx` extienden la metadata con su propio canonical, OG y alternates por path.
- [x] `app/sitemap.ts`: home + `/about` por locale con `xhtml:link rel=alternate` y `x-default`.
- [x] `app/robots.ts`: allow `/`, disallow `/api/`, `sitemap` y `host`.
- [x] `app/rss.xml/route.ts` + `lib/rss.ts`: builder propio (CDATA, escape XML), endpoint con `?lang=es|en`, `Cache-Control` 10min + SWR 1h, `<atom:link rel=self>`, `<category>` por slug, `pubDate` RFC-822.
- [x] `db/queries/articles.listLatestForFeed(locale)`: select locale-aware con `coalesce(title_<loc>, title)`, ordenado por `publishedAt desc`.
- [x] `app/api/health/route.ts`: `select 1` contra Postgres + ultimo `ingested_at` + counts por status; 200/503; `Cache-Control: no-store`.
- [x] `app/[locale]/about/page.tsx`: explicacion "como funciona", listado de fuentes en vivo (`listSourcesPublic`), categorias con su acento, limites honestos. Bilingue (ES/EN).
- [x] Cron via GitHub Actions (`.github/workflows/cron.yml`): `/api/cron/ingest` cada 3h y `/api/cron/classify?limit=20` cada 30min. Cada job hace `curl` con `Authorization: Bearer ${CRON_SECRET}`. Tambien expone `workflow_dispatch` para disparos manuales. **Por que no Vercel cron**: el plan Hobby restringe schedules a 1/dia, lo que dejaba la clasificacion sin cadencia util.
- [x] `components/skip-link.tsx`: enlace "Saltar al contenido" focado, sr-only por defecto, montado en `LocaleLayout` antes del header.
- [x] Foco accesible: `:focus-visible` global con `outline` accent en `globals.css`; `focus-within` ring en `news-card`; `focus-visible` ring en footer/locale-switcher; `aria-current="page"` y `lang={l}` en `locale-switcher`.
- [x] `CategoryFilter` con `role="group"` y `aria-label` (`home.filterCategoriesAria`).
- [x] `@media (prefers-reduced-motion: reduce)` global: anula transiciones/animaciones no esenciales.
- [x] `messages/{es,en}.json` ampliados con `a11y.skipToContent`, `home.filterCategoriesAria`, `footer.about` y todo el namespace `about.*`.
- [x] Tests Vitest nuevos: `tests/site.test.ts` (9 tests sobre `getSiteUrl`/`localizedUrl`/`localeAlternates`) y `tests/rss.test.ts` (6 tests sobre el builder). Suite total: **45 tests**.

### Verificacion local

- `pnpm lint` ✔
- `pnpm typecheck` ✔
- `pnpm test` ✔ (45 tests: 3 smoke + 14 ingest + 13 classify + 9 site + 6 rss)
- `pnpm build` ✔: rutas registradas `/[locale]`, `/[locale]/about`, `/api/cron/{ingest,classify}`, `/api/health`, `/rss.xml`, `/robots.txt`, `/sitemap.xml`.
- Dev smoke (`curl`): `/robots.txt`, `/sitemap.xml`, `/rss.xml`, `/rss.xml?lang=en`, `/api/health`, `/`, `/en`, `/about`, `/en/about` -> todos `200`. Sitemap incluye `<xhtml:link rel="alternate" hreflang>` para `es`, `en`, `x-default`. RSS valida CDATA y `<atom:link rel=self>`. `/api/health` devuelve `{ status: "ok", lastIngestAt, articles: { total, classified, pending, failed } }`.

### Notas operativas

- `NEXT_PUBLIC_SITE_URL` debe poblarse en Vercel con el dominio publico (sin slash). En local cae a `localhost:3000`.
- Las URLs canonicas de la home difieren entre locales: `/` para `es`, `/en` para `en`. Cada par incluye `hreflang` reciproco + `x-default`.
- Lighthouse en preview queda como tarea de Fase 6 una vez el dominio este en Vercel (necesita HTTPS real para medir).
- El crawler ve solo los items `classified` via RSS / sitemap (la home ya filtra por status). Los `pending` siguen invisibles.
- Cron operado desde GitHub Actions: hace falta crear dos secrets en el repo (Settings -> Secrets and variables -> Actions): `KERNELIA_PROD_URL` (p.ej. `https://kernelia.dev`, sin slash) y `CRON_SECRET` (el mismo string que en Vercel).
- En repos publicos, los workflows de tipo `schedule` se desactivan automaticamente tras **60 dias sin actividad**. Cualquier push o PR resetea el contador.

**Criterio de cierre:** auditoria pasada y crons configurados en Vercel preview.

---

## Fase 6 — Release v0.1.0 a produccion · `done`

**Objetivo:** publicar version inicial estable.

### Sub-fase: ajustes post primer deploy (2026-05-14)

Tres bugs/limitaciones detectados al ver el sitio en produccion (https://kernelia.dev):

- [x] **Tailwind v4 purgaba 9 de 10 variables `--color-cat-*`**. Tailwind v4 tree-shake las variables de `@theme` cuyo uso no detecta estaticamente. Como accedemos via `categoryColorVar(slug)` que construye `var(--color-cat-${slug})` dinamicamente, el scanner no las veia y las eliminaba. Solo `--color-cat-other` sobrevivia (por el fallback literal en `news-card.tsx`). Resultado: las cards de cualquier categoria distinta de `other` no mostraban color de filo ni de badge. Fix: mover las 10 vars de `@theme` a un bloque `:root` regular, que siempre se emite.

- [x] **Una fuente (Hugging Face Blog, 777 articulos) monopolizaria el feed** una vez clasificados todos. Cap implementado en `listClassifiedArticles` via CTE con `row_number() over (partition by source_id order by published_at desc)` y `where rn <= 5`. Cada fuente aporta como mucho sus 5 articulos mas recientes al pool global. Aplicado siempre (incluso con filtros/busqueda) para mantener diversidad. Constante `PER_SOURCE_CAP = 5` documentada arriba del archivo.

- [x] **Muchos articulos sin imagen quedaban con placeholder generico** (gradiente + icono sparkles, leia "missing asset"). Sustituido por `SourceCover`: gradiente con el color de la categoria + nombre de la fuente en tipografia grande + label de categoria. Cada card sin RSS-image ahora se ve intencional, no como un fallo. La extension futura (anyadir `sources.image_url` con OG curado) queda como mejora aditiva no bloqueante.

### Sub-fase: dominio, paginacion append y branding (2026-05-14)

- [x] **Dominio `kernelia.dev`**. Registrado y apuntando a Vercel con SSL emitido. Referencias en `PLAN.md` y `README.md` actualizadas; el origin sigue resolviendose por env (`NEXT_PUBLIC_SITE_URL` -> `VERCEL_URL` -> fallback) sin hardcodearlo en codigo.
- [x] **Logo de marca**. Sustituida la estrella generica del header por el wordmark "K" provisto en `media/logo-kernelia.svg`. Mismos paths inlineados en `components/header.tsx` (con `currentColor` para que herede el acento) y en `app/icon.svg` (color teal `#2dd4bf` para que sea visible en tabs tanto claras como oscuras). `app/apple-icon.png` renderizado a 180x180 desde el SVG con fondo `#0f172a` (no del PNG suelto, que tiene padding y queda pequenyo). README usa una version base64 con el mismo color para consistencia visual en GitHub.
- [x] **Paginacion append-style**. "Cargar mas" ya no navega: nuevo endpoint `GET /api/articles` (locale + cursor + q + category + limit) que sirve JSON, mas `components/article-list.tsx` (client) que mantiene los items ya cargados y anyade 6 mas por click. SSR sigue renderizando los 18 primeros para SEO y first paint. Dedupe por `id` defensivo. Cancelacion via `requestIdRef` para que una respuesta vieja no pise una nueva si el usuario cambia de filtro mid-fetch. Sin auto-scroll: el boton es opt-in (mejor para teclado y para llegar al footer).
- [x] **`PER_SOURCE_CAP` 5 -> 10**. 5 dejaba la home demasiado dispersa cuando habia pocos articulos clasificados; 10 mantiene la diversidad sin ahogar a las fuentes activas.
- [x] **NewsCard como client component**. Necesario para que el grid append pueda re-renderizarse. `getTranslations` -> `useTranslations`. Hidratacion del `<time>` relativo: `suppressHydrationWarning` (deriva inocua de segundos entre SSR y client; alternativa "congelar el valor SSR" envejeceria mal en sesiones largas). El payload se serializa via `ArticleCardView` con `publishedAt: string` para que la misma forma sirva al SSR y al fetch JSON.

### Sub-fase: cron en produccion + cola justa (2026-05-14)

Tras mergear PR #6 a main, la cadena de fallos del cron en GHA se resolvio en cinco pasos sucesivos, todos documentados con commits y test contra el endpoint real:

1. **`No host part in the URL`** — Los secretos `KERNELIA_PROD_URL` y `CRON_SECRET` no existian. GitHub sustituye los secrets ausentes por string vacio en silencio. Fix: anyadir `: "${VAR:?msg}"` guards para fallar con mensaje accionable.
2. **Aun vacios con guards** — Los secretos estaban creados pero en el **environment** `Production`, no a nivel repo. `${{ secrets.* }}` solo lee repo/org-level por defecto. Fix: `environment: Production` declarado en cada job.
3. **`Malformed input to a URL function`** — Posible whitespace o falta de scheme en el valor pegado. Fix: trim + regex `^https?://[^/]+$` con `::error::` explicito si no encaja.
4. **`HTTP 307 Redirecting...`** — Vercel tenia `www.kernelia.dev` como canonico y `kernelia.dev` redirigia. Toda la app (canonical, OG, sitemap, README) apuntaba a apex. Fix de config: invertir en Vercel para que apex sea canonico. Estado consistente con lo que el resto del proyecto declara.
5. **`HTTP 504` timeout** — `/api/cron/classify?limit=20` no cabe en los 60s de Vercel Hobby porque el handler espera `DEFAULT_DELAY_BETWEEN_MS=3000` entre articulos (TPM cap de Cerebras free tier). 19 huecos x 3s = 57s solo de delays, antes de las llamadas LLM. Fix: bajar `limit` a 8 (~45-55s end-to-end). Throughput: 8 art/tick x 48 ticks/dia = 384/dia, drena un backlog de ~900 en ~2.5 dias.

Run manual posterior: `processed=8 classified=8 failed=0 duration=24.2s tokens=7266 HTTP 200 in 24.9s`.

- [x] Cron de clasificacion verde en `main`, schedule cada 30min activo, secretos correctos en environment `Production`.

#### Cola de clasificacion justa (post-mortem post-merge)

Tras el primer tick verde la home seguia mostrando "40 noticias y ya". No era bug visual sino el cap por fuente haciendo su trabajo: 4 fuentes con clasificadas x cap=10 = 40 cards. Diagnostico via `db/inspect-sources.ts`:

```
                            pending   classified
Hugging Face Blog              725         52      <- 42 ocultas por el cap
Google DeepMind Blog           100          0      <- nunca clasificada
Ars Technica - AI               20          0
TechCrunch AI                    0         20      <- 10 ocultas por el cap
The Verge - AI                   1         10
MIT Technology Review            0         10
Genbeta - IA                    10          0
Xataka                          10          0
Wired - AI                      10          0
VentureBeat AI                   7          0
```

`listPendingArticles` ordenaba `ORDER BY ingested_at ASC` puro (FIFO). Hugging Face Blog con 725 pendientes monopolizaba el cron: a ritmo de 8/tick x 48 ticks/dia, el resto de fuentes no se tocarian en ~2 dias. El cap por fuente del lado *display* nunca iba a llenarse mas alla de 4-5 fuentes.

- [x] **Round-robin en `listPendingArticles`**. CTE con `row_number() over (partition by source_id order by ingested_at asc, id asc)`, ordenando el outer por `rn asc, ingested_at asc`. Con limit=N, primero la mas vieja de cada una de N fuentes distintas, luego la segunda de cada una, etc. Verificado contra DB real: en los primeros 16 pendientes ahora aparecen las 8 fuentes con pending (spread 3/2/2/2/2/2/2/1 vs el viejo 16/0/0/0/0/0/0/0 dominado por Hugging Face).
- [x] Drizzle gotcha: al pedir tanto `articles.language` como `sources.language` en el inner select de un `$with(...)` CTE, Drizzle no aliasa (emite ambos como `"X"."language"`) y Postgres devuelve "column reference ambiguous". Fix: envolver en `sql<T>...as("article_language" | "source_language")` para forzar nombres distintos. Documentado con comentario en el codigo.
- [x] `db/inspect-sources.ts` y `db/inspect-pending-order.ts` como scripts de diagnostico vivos (no parte del runtime).

### Sub-fase: cierre v0.1.0 (2026-05-14)

- [x] **`NEXT_PUBLIC_SITE_URL` poblado en Vercel Production**. Detectado al smoke-testear: `robots.txt`, `sitemap.xml`, `rss.xml`, `<link rel=canonical>` y `<meta property=og:url>` servian `kernelia.vercel.app` (fallback de `VERCEL_URL`). Causa: `NEXT_PUBLIC_*` se inlinea en el bundle al hacer `next build`, asi que la env var solo aplica a deployments nuevos. Fix: setear `NEXT_PUBLIC_SITE_URL=https://kernelia.dev` y redeploy sin cache. Verificado contra los 5 producers post-redeploy.
- [x] **Cron de clasificacion validado en produccion**. Run manual sobre `main`: `processed=8 classified=8 failed=0 duration=24.6s`. Round-robin observado en la DB: el tick anadio 1 articulo a 8 fuentes distintas (Google DeepMind, Ars Technica, Genbeta, Xataka, Wired, VentureBeat estrenaron clasificacion).
- [x] **`v0.1.0` taggeado y publicado**. Release notes con narrativa de las 6 fases y stack tecnico.

### Pendiente post-release (no bloqueante)

- [ ] Reclasificar el backlog completo de ~870 articulos pending (el cron lo drena en ~2.5 dias automaticamente).
- [ ] Smoke test en produccion con datos reales durante 48h (monitorear `/api/health` y que `classified` siga creciendo).
- [ ] Verificar que el job de `ingest` cada 3h tambien corre al menos una vez (la primera ventana cae aprox a las :00 mas cercanas a un multiplo de 3h UTC).
- [ ] Anuncio publico (opcional).

**Criterio de cierre:** dominio publico sirviendo articulos clasificados al dia, en ES y EN, con SEO consistente y cron auto-sostenido. **Cumplido.**

---

## Fase 7 — Backoffice admin: auth, panel y gestion · `pending`

**Objetivo:** dar al operador humano una superficie privada (`/admin`)
para observar la web, gobernar el contenido y administrar usuarios
sin tocar la DB a mano ni pelearse con Vercel/Supabase para tareas
rutinarias.

### Excepcion a la regla "sin auth"

`context-docs/non-negotiable.md` declara hoy "Web publica, sin auth".
Esta fase introduce auth pero **solo** para la superficie `/admin/*`,
que es estrictamente interna. El feed publico, `/api/articles`,
`rss.xml`, `sitemap.xml`, `robots.txt` y todo lo SEO siguen sin auth
y siguen siendo el producto. `/admin/*` lleva `noindex, nofollow` y
queda fuera del sitemap.

Al cerrar la fase, el mismo PR debe actualizar:
- `context-docs/non-negotiable.md`: reformular el punto a "lectura
  publica + backoffice privado en `/admin`".
- `context-docs/coding-principles.md`: declarar los modulos nuevos
  (`lib/auth/`, `lib/email/`, `db/queries/users.ts`,
  `db/queries/cron-runs.ts`).
- `AGENTS.md`: anyadir nota sobre la superficie admin en el resumen.

### Decisiones de arquitectura (cerradas)

- **Auth:** **magic-link por email**. Sin contrasenyas ni hashes.
  La identidad de un user es su email; para entrar pide un link,
  lo recibe en su bandeja y al pulsarlo se crea una sesion. Esto
  elimina toda la superficie de password storage, rotacion, polizas,
  brute-force y reset flows.
- **Proveedor de email:** **Resend**. Free tier (100 emails/dia)
  cubre con margen el uso real (1-3 emails por sesion por admin).
  Requiere verificar el dominio `kernelia.dev` en Resend (registros
  DNS SPF/DKIM). Si en el futuro hace falta migrar, el helper
  `lib/email/send.ts` aisla la integracion en un punto.
- **Tokens de magic-link:** opaque, 32 bytes random base64url. TTL
  15 min. Se almacena el SHA-256 en `magic_link_tokens.token_hash`
  (no el plaintext); al pulsar el link comparamos hashes via
  `crypto.timingSafeEqual`. Single-use: marca `used_at` al primer
  consumo, rechazo si ya tiene `used_at` o si paso `expires_at`.
- **Bootstrap del admin:** env var `INITIAL_ADMIN_EMAIL`. El seed
  crea un user con ese email **solo si no existe ningun user en
  la tabla todavia** (idempotente). Sin contrasenyas por defecto,
  sin force-change.
- **Sesion:** cookie HTTP-only + signed token. Tabla `sessions`
  (id, user_id, created_at, expires_at, last_used_at) para poder
  revocar logout-side sin esperar a expiracion. La cookie lleva
  solo el `session_id` firmado con HMAC y `SESSION_SECRET`.
  TTL 7 dias; refresh `last_used_at` en cada uso.
- **Locale del admin:** sin segmento `[locale]`. `/admin` plano,
  copy en ES (lengua del operador). Si en el futuro hace falta EN,
  se anyade despues.
- **Rate-limit de magic-link:** in-memory counter por IP **y** por
  email (5 solicitudes / 10 min, lo que se cumpla primero). Bastante
  para Hobby; no necesitamos Redis.
- **Indexacion:** `app/admin/layout.tsx` emite `<meta name="robots"
  content="noindex,nofollow">` y `sitemap.ts` / `robots.ts` excluyen
  explicitamente `/admin`.
- **`user_type` enum.** Solo `admin` hoy. Declarado como enum
  Postgres extensible (`editor`, `viewer` reservados para mas
  adelante) para no migrar de string a enum despues.
- **Gestion de categorias:** **solo a nivel articulo individual**.
  El admin puede reasignar la categoria de un articulo concreto
  entre los 10 slugs vigentes (parte de 7.D). **No** se permite
  editar nombres del catalogo, crear nuevas, ni borrar. Editar el
  catalogo o crear nuevos slugs toca el prompt del LLM y queda
  fuera de scope: si llega a hacer falta se abre como fase aparte.

### Schema (Drizzle)

Tres tablas nuevas + un valor nuevo en `articleStatusEnum`:

```ts
// users — operadores del backoffice (auth por email)
export const userTypeEnum = pgEnum("user_type", ["admin"]); // extensible
export const users = pgTable("users", {
  id: uuid().primaryKey().default(sql`gen_random_uuid()`),
  // Guardar en lowercase + trim para deduplicar variantes ("Foo@x"
  // vs "foo@x"). Validado con Zod antes del insert.
  email: text().notNull().unique(),
  userType: userTypeEnum("user_type").notNull().default("admin"),
  active: boolean().notNull().default(true), // soft-disable sin borrar
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

// magic_link_tokens — single-use, TTL corto (15min)
export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull().references(() => users.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(), // sha256 del token plaintext
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("magic_link_tokens_user_id_idx").on(t.userId)],
);

// sessions — vida del login una vez consumido el magic-link
export const sessions = pgTable("sessions", {
  id: uuid().primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// cron_runs — historial de ejecuciones para el monitor
export const cronJobEnum = pgEnum("cron_job", ["ingest", "classify"]);
export const cronStatusEnum = pgEnum("cron_run_status", ["ok", "partial", "failed"]);
export const cronRuns = pgTable("cron_runs", {
  id: uuid().primaryKey().default(sql`gen_random_uuid()`),
  job: cronJobEnum().notNull(),
  status: cronStatusEnum().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  // classify: processed/classified/failed/timedOut/budgetExhausted/tokens
  // ingest: feedsAttempted/articlesInserted/errors
  // JSONB libre para no migrar cada vez que cambie el resumen.
  summary: jsonb().notNull(),
  errorMessage: text("error_message"),
});

// articleStatusEnum — anyadir valor "hidden"
// alter type article_status add value 'hidden';
// La migracion debe correr ANTES de cualquier deploy que asuma el
// nuevo valor en aplicacion (Postgres no permite usar valores de
// enum recien anyadidos dentro de la misma transaccion).
```

### Por que `status = 'hidden'` y no una columna `active`

Reutilizar el enum `status` (anyadiendole `hidden`) en lugar de una
columna `active` separada tiene dos ventajas:

1. **Las queries publicas no cambian.** Ya filtran `status =
   'classified'`. Los articulos hidden quedan fuera del feed, RSS,
   sitemap y contadores **automaticamente**, sin tocar 5 sitios.
2. **Una sola fuente de verdad para "estado de un articulo".** Un
   articulo es exactamente uno de: pending, classified, failed,
   hidden. Sin combinaciones imposibles que validar (e.g. "failed
   pero active=true").

El precio: el admin no puede mover `pending → classified` a mano sin
mas. Solo es legal si el articulo ya tiene `category_id`, `title_es`,
`title_en`, `summary_es`, `summary_en` poblados — las mismas
columnas que el clasificador automatico exige. El guard vive en
`adminSetArticleStatus(id, newStatus)` y se valida tanto via Zod
como con un read previo a la DB:

```ts
// db/queries/admin-articles.ts
export async function adminSetArticleStatus(
  id: string,
  newStatus: ArticleStatus,
): Promise<void> {
  if (newStatus === "classified") {
    const [row] = await db
      .select({
        categoryId: articles.categoryId,
        titleEs: articles.titleEs,
        titleEn: articles.titleEn,
        summaryEs: articles.summaryEs,
        summaryEn: articles.summaryEn,
      })
      .from(articles)
      .where(eq(articles.id, id))
      .limit(1);
    if (!row) throw new Error("Article not found");
    const missing = [];
    if (!row.categoryId) missing.push("category_id");
    if (!row.titleEs)   missing.push("title_es");
    if (!row.titleEn)   missing.push("title_en");
    if (!row.summaryEs) missing.push("summary_es");
    if (!row.summaryEn) missing.push("summary_en");
    if (missing.length > 0) {
      throw new Error(
        `Cannot set status='classified': missing ${missing.join(", ")}`,
      );
    }
  }
  await db.update(articles).set({ status: newStatus }).where(eq(articles.id, id));
}
```

Las otras transiciones son libres (`classified ↔ hidden`,
`classified → pending`, `failed → pending`, etc.).

### Sub-fase 7.A · Schema + auth backend (magic-link)

- [x] Migracion Drizzle: tablas `users`, `magic_link_tokens`,
  `sessions`, `cron_runs`; nuevo valor `hidden` en
  `articleStatusEnum`. Indices: `users.email` unique ya esta por
  el `.unique()`, anyadir `sessions.user_id`,
  `cron_runs.started_at desc`, `magic_link_tokens.user_id`.
- [x] `db/seed.ts`: si no existe ningun user, insertar uno con
  `email = process.env.INITIAL_ADMIN_EMAIL`, `user_type = 'admin'`.
  Fail-fast si la env var falta. Idempotente: re-correr el seed
  no toca users existentes.
- [x] `lib/auth/tokens.ts`: `generateMagicLinkToken(userId)` ->
  devuelve `{ plaintext, hash }`. `verifyAndConsumeToken(plaintext)`
  -> devuelve `{ userId }` o lanza. `crypto.timingSafeEqual` para
  el compare.
- [x] `lib/auth/sessions.ts`: `createSession(userId)`,
  `getUserBySession(sessionId)`, `revokeSession(sessionId)`.
  TTL 7 dias; refresh `last_used_at` en cada uso.
- [x] `lib/email/send.ts`: helper minimalista alrededor de la API
  de Resend. Funcion `sendMagicLink({ to, link })`. Plantilla HTML
  + text inline en el modulo (no JSX) para no traerse @react-email.
- [x] Cookie: `__Host-kernelia-session`, `HttpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`. Valor: `session_id` firmado HMAC con
  `SESSION_SECRET`. `getSessionFromCookie(req)` helper compartido.
- [x] Rate-limit en `/api/admin/magic-link` (Map en memoria,
  5 solicitudes / 10 min por IP y por email).
- [x] Env vars nuevas: `RESEND_API_KEY`, `EMAIL_FROM`
  (e.g. `admin@kernelia.dev`), `INITIAL_ADMIN_EMAIL`,
  `SESSION_SECRET`. Documentadas en `README.md` y verificadas en
  boot con fail-fast.
- [x] Tests Vitest para tokens, sessions y rate-limit.

### Sub-fase 7.B · Login via magic-link

- [x] `app/admin/login/page.tsx`: server component con form post a
  `/api/admin/magic-link`. Un solo input (email) + boton "Enviarme
  enlace". Sin JS para el happy path; mensaje "Si ese email tiene
  acceso, recibiras un enlace en breve" (constante: no revelamos
  si el email existe en DB — evita enumeracion).
- [x] `app/api/admin/magic-link/route.ts`: POST con `email`.
  Validar via Zod, normalizar lowercase+trim. Si existe user
  activo, generar token, persistir hash, enviar email. Si no
  existe, **igualmente** devolver 200 sin pista para el cliente.
  Aplica el rate-limit antes del lookup.
- [x] `app/admin/auth/callback/route.ts`: GET con `?token=...`.
  Verifica + consume el token. Si ok, crea session, set-cookie,
  redirect a `/admin`. Si no, redirect a `/admin/login?error=expired`.
- [x] `app/admin/layout.tsx`: middleware-style — valida sesion,
  redirige a `/admin/login` si no hay. Si la hay pero el user
  esta `active=false`, revoca todas sus sessions y redirige a
  `/admin/login?error=revoked`.
- [x] `<meta name="robots" content="noindex,nofollow">` en el layout.
- [x] Excluir `/admin` de `app/sitemap.ts` y `app/robots.ts`.
- [x] Logout: `POST /api/admin/logout` que invalida la session row y
  borra cookie. Boton en el header del admin.

### Sub-fase 7.C · Panel de metricas + monitor del cron

- [x] `app/admin/page.tsx` (dashboard): cards con totales agregados
  obtenidos via nuevas queries en `db/queries/admin.ts`:
  - Articulos: total / classified / pending / failed / hidden
  - Por categoria (reusar `getCategoryFacets`, ampliar con
    breakdown por status)
  - Por fuente (count + last_ingested_at por fuente)
  - Tokens consumidos por dia (ultimos 7 dias) desde `cron_runs`
- [x] `app/admin/cron/page.tsx`: tabla con ultimas 50 ejecuciones
  de `cron_runs`, ordenadas desc. Muestra job, status, duracion,
  resumen relevante (processed/classified/failed/timedOut para
  classify, inserted/errors para ingest). Filtro por job y status.
- [x] `lib/cron-logging.ts`: helper que `runClassify` y `runIngest`
  llaman al final para persistir en `cron_runs`. Catch defensivo:
  fallo de logging no debe tumbar el cron.
- [x] Modificar `/api/cron/{classify,ingest}/route.ts` para
  escribir el resultado en `cron_runs` al terminar (success o
  caught error).
- [x] Mostrar info estatica del schedule: "ingest cada 3h en UTC
  multiplo-de-3, classify cada 30min". Hardcoded en una constante
  leida tanto por `cron.yml` como por el panel — fuente unica.

### Sub-fase 7.D · Gestion de articulos

- [x] `app/admin/articles/page.tsx`: tabla paginada (cursor) con
  filtros por status, categoria, fuente. Columnas: title, source,
  category, published_at, status. El status `hidden` se muestra
  con badge distinto a `failed` para distinguir decision humana
  vs error del LLM.
- [x] Accion "Cambiar status": dropdown con los 4 valores del
  enum. POST `/api/admin/articles/[id]/status`. Server-side usa
  `adminSetArticleStatus` que aplica el guard descrito arriba
  (cambiar a `classified` exige las 5 columnas pobladas). Si el
  guard falla, devuelve 422 con el listado de campos faltantes;
  la UI muestra el mensaje sin recargar.
- [x] Accion "Reasignar categoria": dropdown con los 10 slugs
  vigentes (mas `null` = sin categoria). Endpoint similar. **Solo**
  reasigna; no edita el catalogo de categorias. El admin no puede
  crear ni renombrar slugs (decision cerrada arriba).
- [x] Accion "Re-clasificar": atajo que mueve un articulo
  `classified` o `failed` a `pending` y limpia
  `classification_error`. Util cuando el LLM se equivoco. El
  proximo tick del cron lo recoge.
- [x] Audit-friendly: cualquier cambio de status o categoria desde
  el admin loggea via `console.log` estructurado (`{ adminEmail,
  articleId, action, before, after, ts }`). Sin tabla de audit-log
  dedicada en V1.

### Sub-fase 7.E · Gestion de usuarios

- [x] `app/admin/users/page.tsx`: lista con email, user_type,
  active, last_login_at. Boton "anyadir usuario" y acciones por
  fila: desactivar / reactivar, borrar.
- [x] Endpoint POST `/api/admin/users`: anyadir un email nuevo
  como user `admin` activo. No requiere "invitar" via email — el
  user invitado simplemente entra a `/admin/login`, pide
  magic-link, y entra.
- [x] Endpoint DELETE / PATCH `/api/admin/users/[id]`: desactivar
  / reactivar / borrar. Al desactivar, revocar todas sus sessions
  activas (`delete from sessions where user_id = ?`).
- [x] Guardrails: no permitir borrarse / desactivarse a uno mismo;
  no permitir dejar el sistema sin ningun admin activo (check
  antes de desactivar / borrar).

### Seguridad — lista de comprobacion

- [x] Cookie `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`.
- [x] HMAC sign del session id con `SESSION_SECRET` (env var
  obligatoria, fail-fast en boot si falta).
- [x] Tokens de magic-link almacenados como SHA-256, single-use,
  TTL 15min. Compare con `crypto.timingSafeEqual`.
- [x] Rate-limit en magic-link (5/10min por IP **y** por email).
- [x] Respuesta del endpoint magic-link constante: "si el email
  tiene acceso, recibiras un enlace". No revela si el email
  existe (evita enumeracion).
- [x] CSRF: usar Next server actions o form post + SameSite=Lax.
  Magic-link de por si mitiga (el token GET-able no es exploitable
  sin acceso al inbox).
- [x] Logs: nunca loguear tokens completos, secrets, ni el cookie.
  Solo `userId`, `email` y prefijo del session id si hace falta
  correlar.
- [x] Verificar el dominio `kernelia.dev` en Resend (SPF + DKIM)
  antes de enviar nada en produccion. Sin verificacion los emails
  van a spam o se rechazan.

### Open questions

- [ ] **CSP**. El admin no necesita inline scripts; conviene
  endurecer Content-Security-Policy solo para `/admin/*` antes de
  exponerlo. Tirarlo a follow-up post-cierre si retrasa.
- [ ] **2FA / TOTP**. Out of scope inicial. Mencionado para que
  conste como camino natural si se anyaden mas usuarios. Magic-link
  ya supone factor "tienes acceso al inbox".
- [ ] **Audit log**. Sin tabla dedicada en V1; `console.log`
  estructurado es suficiente para un operador unico. Si se anyaden
  mas users, abrir sub-fase para tabla `audit_events`.

### Criterio de cierre

1. Primer login en produccion: pides magic-link al email definido
   en `INITIAL_ADMIN_EMAIL`, llega a tu inbox, lo pulsas, te
   redirige a `/admin` con metricas en vista.
2. Mover un articulo a `status='hidden'` desde el admin lo oculta
   inmediatamente del feed publico, del RSS y del sitemap (sin
   tocar las queries: el filtro `status='classified'` ya hace el
   trabajo).
3. Intentar mover un articulo `pending` (sin categoria/titulos/
   resumenes en su idioma) a `classified` falla con mensaje
   accionable; mover uno que SI los tiene funciona.
4. Reasignar la categoria de un articulo desde el admin se ve
   reflejado en la home publica al refrescar.
5. Anyadir un segundo usuario admin desde `/admin/users`, hacer
   logout, pedir magic-link con el email nuevo: llega, entra,
   funciona.
6. Tabla `cron_runs` se rellena automaticamente con cada tick del
   cron en GHA; el monitor en `/admin/cron` muestra los ultimos 50.
7. `noindex,nofollow` en `/admin/*` verificado en HTML de la
   preview de Vercel.
8. `context-docs/non-negotiable.md`, `context-docs/coding-principles.md`
   y `AGENTS.md` actualizados en el mismo PR (sub-fase 7.A o donde
   toque la regla).

### Sub-fase 7.F · Refactor de auth a email + contrasenya

Decision (2026-05-16): se retira magic-link como mecanismo de login.
El usuario y el operador prefieren contrasenya clasica. Resend pasa
a usarse SOLO para enviar enlaces de password-reset.

- [x] Migracion Drizzle `0004_admin_passwords.sql`:
  - `users.password_hash text` (nullable; NULL = sin contrasenya aun).
  - `password_reset_tokens` (misma forma que magic_link_tokens).
  - `DROP TABLE magic_link_tokens CASCADE`.
- [x] `lib/auth/passwords.ts`: `hashPassword` / `verifyPassword` con
  `bcrypt-ts` (cost 12; sin deps nativas → compatible Vercel
  serverless). Politica: min 12 chars, max 256, sin reglas de
  composicion (NIST 800-63B).
- [x] `lib/auth/password-reset.ts`: tokens SHA-256 + single-use con
  `verify` (read-only) separado de `consume` (atomico). TTL 30min.
  `invalidateAllResetTokensForUser` para invalidar enlaces pendientes
  tras un reset exitoso.
- [x] `lib/email/send.ts`: `sendPasswordReset` (renombrado desde
  `sendMagicLink`). Mismo wrapper Resend, plantilla nueva.
- [x] `lib/auth/login-flow.ts`: orquestacion email+password con
  injectables. Anti-enumeracion: misma respuesta para unknown_email,
  inactive_user, wrong_password, password_hash=NULL.
- [x] `lib/auth/forgot-password-flow.ts`: misma estructura que la
  vieja magic-link-flow; rate-limit IP + email (5/10min).
- [x] Rate-limit reforzado en login: IP 10/10min; email-FAILURE-only
  5/15min (un login OK no consume budget). `peekRateLimit` nuevo.
- [x] Routes: `POST /api/admin/login`, `POST /api/admin/forgot-password`,
  `POST /api/admin/reset-password`. Cookie de sesion identica a la
  fase 7.B (`__Host-kernelia-session`, HMAC). El reset revoca TODAS
  las sesiones activas del usuario tras escribir el nuevo hash.
- [x] UI: `/admin/login` (email + password + link a forgot),
  `/admin/forgot-password` (sent banner constante), `/admin/reset-password?token=...`
  (verifica el token server-side antes de pintar el form).
- [x] Bootstrap del primer admin: seed inserta el row con
  `password_hash=NULL`; el operador entra a `/admin/login`, pulsa
  "olvidaste contrasenya", recibe enlace por Resend, pone su primera
  contrasenya. Mismo camino para usuarios anyadidos via 7.E.
- [x] Eliminadas: `lib/auth/tokens.ts`, `lib/auth/magic-link-flow.ts`,
  `app/api/admin/magic-link/`, `app/admin/auth/callback/`,
  `tests/magic-link-flow.test.ts`, `tests/auth-tokens.test.ts`.
- [x] Tests Vitest: `auth-passwords.test.ts` (policy + hash/verify
  roundtrip), `forgot-password-flow.test.ts` (port del antiguo),
  `login-flow.test.ts` (rate-limit + anti-enumeracion + no-budget-
  on-success), `auth-rate-limit.test.ts` ampliado con
  `peekRateLimit`.
- [x] `.env.example`, `non-negotiable.md`, `coding-principles.md`,
  `AGENTS.md` actualizados.

### Sub-fase 7.G · Dashboard redisenyado con sidebar + health card

- [x] Layout `/admin/*` con sidebar fija (Panel · Articulos · Usuarios
  · Cron) y header sticky con email + logout. La sidebar es un
  client component (`usePathname` para `aria-current`); el resto
  del layout sigue siendo server.
- [x] Mobile: la sidebar colapsa a un strip horizontal scroll sobre
  el contenido. Sin hamburguesa — los 4 items caben.
- [x] `lib/health.ts`: helper `probeHealth()` compartido por
  `/api/health` y el dashboard. El admin lo llama por funcion
  directa (no por fetch interno) para evitar un round-trip HTTP.
  El endpoint publico se queda fino: invoca `probeHealth` y
  traduce a 200/503.
- [x] `components/admin/health-card.tsx`: status pill (200/503),
  DB latencia con warn >=500ms, ultimo ingest relativo, counts
  por status. Server-rendered, sin auto-refresh — recargar la
  pagina re-corre el probe.
- [x] Refactor de `app/admin/(private)/page.tsx`: card de salud
  arriba, grid compacto de totales (5-up), tablas por categoria
  / fuente / tokens 7d, schedule del cron al pie. Eliminadas las
  cards-navegacion duplicadas (Usuarios/Cron) — la sidebar ya
  ocupa ese rol.
- [x] Tests: `tests/admin-sidebar.test.ts` (logica de active-link
  pura, extraida como `isNavItemActive`) + `tests/health.test.ts`
  (contrato del union `HealthResult`).

### Sub-fase 7.H · Graficas (tokens, classified, status, fuentes)

- [x] Recharts 3.8.1 instalado. Cuatro graficas, todas client islands
  (Recharts toca el DOM), envueltas en `ResponsiveContainer`:
  1. **Tokens consumidos por dia, ultimos 30d** — stacked bar
     prompt+completion. Reusa `getTokensPerDay(30)`.
  2. **Articulos clasificados por dia, ultimos 30d** — line con dos
     series: classified (solido accent) + failed (dasheado rojo).
     Nueva query `getClassifiedPerDay(30)`.
  3. **Estado de articulos** — donut: classified / pending / failed
     / hidden. Reusa `getArticleStatusCounts`. Tooltip con porcentaje;
     fallback "Sin datos" en DB vacia.
  4. **Volumen por fuente, ultimos 30d** — bar horizontal top-10.
     Nueva query `getSourceVolume({days, topN})`. Altura escala con
     numero de filas. Layout horizontal porque los nombres de fuente
     son largos.
- [x] Dashboard re-organizado:
  - Status: grid 5-up de numeros + donut al lado (2 columnas en lg).
  - Output del cron 30d: tokens (bar) + classified (line) en 2 columnas.
  - Volumen por fuente: bar arriba; tabla completa con `<details>`
    abajo como drill-down.
  - Categorias: tabla (10 slugs fijos son mas legibles tabular).
- [x] `components/admin/charts/chart-theme.ts` con paleta y estilos
  comunes para que las 4 graficas se vean coherentes.
- [x] Test `admin-metrics-shape.test.ts` pinea los campos que las
  graficas leen — cualquier rename silencia el SVG, asi que el
  shape contract es lo que mas importa.

---

## Fase 8 — Distribucion y propagacion del portal · `pending`

**Objetivo:** poner Kernelia a la vista sin obligar al operador a
mantener presencia personal en redes. La marca habla por si misma —
cuentas bot, share-buttons, newsletter — y todas las superficies de
publicacion son a nombre del producto, no del autor.

### Decisiones cerradas (2026-05-18)

- **Plataformas** del broadcaster: Mastodon (fosstodon.org) +
  Bluesky (kernelia.dev) + Telegram channel "Kernelia". Discord
  out-of-scope hasta que haya comunidad real.
- **Estrategia de publicacion**: per-articulo con filtro
  `relevance_score >= 0.75`. Volumen objetivo ~10-20/dia frente a
  ~50 sin filtro. Articulos pre-migracion 8.A (sin `relevance_score`
  poblado) quedan NULL y no se broadcastean → cero flood de backlog.
- **Idioma**: solo espanol. Una voz por plataforma, audiencia
  principal ES, simple. Si en el futuro se quiere EN se abriran
  cuentas paralelas (`@kernelia_en`).
- **Alcance Fase 8**: suite completa en 3 sub-fases (8.A
  broadcaster / 8.B share-buttons + /about / 8.C newsletter +
  /api/stats). Misma cadencia de entrega que Fase 7 — PR por
  sub-fase.

### Sub-fase 8.A · Broadcaster bot multiplataforma

- [ ] Migracion `0005_broadcast_distribution.sql`:
  - `articles.relevance_score real` (nullable). Pre-migracion = NULL.
  - `broadcast_platform` enum (`mastodon | bluesky | telegram`).
  - `article_broadcasts` (id, article_id FK CASCADE, platform,
    posted_at, external_id, created_at). Unique (article_id,
    platform) para idempotencia per-plataforma.
  - `ALTER TYPE cron_job ADD VALUE 'broadcast'`.
- [ ] Persistir `relevance_score` en `markArticleClassified` y
  propagarlo desde `runClassify` (`ClassifiedPayload` actualizado).
  Articulos clasificados a partir de aqui llevan score; los antiguos
  se quedan NULL hasta que un re-classify los toque.
- [ ] `lib/broadcast/format.ts`: format-per-platform con truncado
  duro (Mastodon 500, Bluesky 300, Telegram 4096). Incluye titulo
  ES + resumen ES + URL + `#categoria` (Mastodon/Telegram).
- [ ] Clientes HTTP por plataforma:
  - `lib/broadcast/mastodon.ts` → `POST /api/v1/statuses` con
    `Authorization: Bearer MASTODON_ACCESS_TOKEN`. Devuelve `{id}`
    para guardar como `external_id`.
  - `lib/broadcast/bluesky.ts` → `com.atproto.repo.createRecord`.
    Login con app-password, sesion en memoria por proceso.
    Construye `richtext facets` para que el link sea clickeable.
  - `lib/broadcast/telegram.ts` → `sendMessage` con `parse_mode:
    MarkdownV2`. Bot API token + `chat_id` (channel @kernelia).
- [ ] `db/queries/article-broadcasts.ts`:
  - `listPendingForBroadcast(platform, {minScore, limit})` — JOIN
    articles donde `status='classified' AND relevance_score >= ?`
    y no exista fila en `article_broadcasts` para esa platforma.
  - `recordBroadcast({articleId, platform, externalId})`.
- [ ] `lib/broadcast/run.ts`: `runBroadcast(opts)` orquestador.
  Plataformas en `Promise.all` (independientes); articulos serial
  por plataforma con `sleep(2000)` entre posts. Wall-clock budget
  52s (mismo que classify). Devuelve summary
  `{posted: { mastodon, bluesky, telegram }, failed, skipped}`.
- [ ] `app/api/cron/broadcast/route.ts` — `GET` protegido por
  `CRON_SECRET`, `maxDuration = 60`, logging a `cron_runs` (status
  ok / partial / failed via mismo helper que classify).
- [ ] `.github/workflows/cron.yml`: nuevo step "broadcast" cada
  30min en `*:15` y `*:45` (offset 15min sobre classify a `*:00` y
  `*:30` para que classify termine antes de que broadcast empiece).
- [ ] Env vars nuevas en `.env.example`, `non-negotiable.md`,
  `AGENTS.md`:
  - `MASTODON_INSTANCE_URL`, `MASTODON_ACCESS_TOKEN`
  - `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD`
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
  - `BROADCAST_ENABLED` (boolean; pausar sin redeploy)
  - `BROADCAST_MIN_RELEVANCE_SCORE` (default `0.75`)
- [ ] Tests Vitest:
  - `format.test.ts` — truncado preserva URL + handles emoji.
  - `run-broadcast.test.ts` — orchestrador con clientes mock:
    happy path, una plataforma falla (otras posean), idempotencia
    (articulo ya en `article_broadcasts` para Mastodon pero no
    Bluesky → solo Bluesky se publica).

### Sub-fase 8.B · Share-buttons + /about ampliada

- [x] `components/share-buttons.tsx` (client island) en cada
  `news-card`: copiar link al portapapeles con feedback "Copied!"
  durante 1.5s, abrir mailto con subject+body precargados, Mastodon
  share-intent (`mastodon.social/share?text=&url=`) que respeta la
  instancia del usuario. Sin botones de redes propietarias
  (Twitter/Meta) — no encaja con la postura del operador.
  - Posicionado con `relative z-10` para sentarse por encima del
    `after:absolute inset-0` del titulo (que vuelve toda la card
    clickable hacia el articulo); `e.stopPropagation()` defensivo.
- [x] `lib/broadcast-channels.ts`: resuelve los perfiles publicos de
  Mastodon / Bluesky / Telegram desde las MISMAS env vars que usa el
  bot broadcaster (`MASTODON_INSTANCE_URL`, `BLUESKY_IDENTIFIER`,
  `TELEGRAM_CHAT_ID` — privado o numerico devuelve null). Asi los
  links "Siguenos en..." nunca apuntan a un canal sin configurar.
- [x] `app/[locale]/about/page.tsx` ampliada:
  - **Hero**: logo de Kernelia (88x88, rounded) al lado del titulo
    e intro. Sirve para Open Graph mas adelante.
  - **Suscribete**: badges con RSS·ES, RSS·EN y los 3 canales del
    broadcaster (links publicos al perfil de Mastodon/Bluesky/
    Telegram, resueltos via `lib/broadcast-channels.ts`).
  - **Creditos**: bloque al pie con credit al logo + identidad +
    codigo via @raulfdeztdo, link a su GitHub. Mismo bloque
    explica que el proyecto es open-source y aceptamos PRs.
- [x] `components/footer.tsx`: logo (28x28) a la izquierda del
  tagline; lista de los canales configurados a la derecha (mismo
  helper, misma fuente de verdad).
- [x] i18n: claves nuevas en `share.*` (copy/copied/email/mastodon),
  `about.subscribe.*` (title/body), `about.credits.*` (title/body
  con `t.rich` para inyectar el link al autor). Sin emojis en
  copy — no esta en la convencion del proyecto.
- [x] Tests: `tests/broadcast-channels.test.ts` con 11 specs que
  cubren la resolucion env-driven, fallback al username por
  defecto, strip del trailing slash, y el corner del Telegram
  numerico (private channel → null para no romper t.me/).
- [ ] Listar Kernelia en awesome-lists relevantes via PR upstream.
  Doc paso a paso en `context-docs/distribution.md` (pendiente —
  posible sub-PR o cierre dentro de 8.C).

### Sub-fase 8.C · Newsletter semanal + /api/stats publico

Dividida en dos PRs:

- **8.C.1** — `/api/stats` + pagina `/stats` + doc de distribucion
  upstream. Sin dependencias externas.
- **8.C.2** — Newsletter completa (migracion + endpoints + cron
  weekly-digest + UI en /about). Bloqueada hasta tener Resend
  configurado.

#### 8.C.1 · Stats publico + doc distribution

- [x] `lib/stats.ts` — `getPublicStats()` server-shared entre
  endpoint y pagina. Una sola fan-out con `Promise.all` de 7
  agregados (clasificados total, clasificados 7d, fuentes activas,
  categorias, tokens 30d, lastIngestAt y lastClassifyAt). Lee
  `cron_runs.summary->tokens.total` para tokens, y `cron_runs`
  filtrado por job + `status='ok'` para los timestamps (asi un tick
  que no encontro nada sigue contando como "el sistema esta vivo").
- [x] `app/api/stats/route.ts` — runtime nodejs, `Cache-Control:
  public, s-maxage=3600, stale-while-revalidate=86400`, CORS abierto
  con `OPTIONS` preflight. Sin auth. Devuelve 503 si la DB cae.
- [x] `app/[locale]/stats/page.tsx` — server component bilingue.
  Stats cards con el mismo lenguaje visual del admin (border +
  surface + tabular-nums), enlace al endpoint JSON, timestamp de
  generacion. Metadata con canonical + alternates.
- [x] i18n keys nuevas: namespace `stats.*` + `footer.stats` en
  ambos locales. Enlace `Estadisticas / Stats` en el footer junto a
  `Sobre el proyecto`.
- [x] `tests/stats.test.ts` — contrato de tipos para `PublicStats`
  (top-level keys, nullables, invariante 7d <= total). Misma
  filosofia que `tests/health.test.ts` y `tests/admin-metrics-shape.test.ts`:
  shape-tests; behavioural coverage en smoke contra Supabase.
- [x] `context-docs/distribution.md` — awesome-lists tier 1/2/3,
  plantilla de entrada, reglas de PRs (uno por entrada,
  alfabetico, sin marketing-speak), seguimiento `[merged]` /
  `[declined]`.

#### 8.C.2 · Newsletter semanal Resend

- [ ] Migracion: tabla `newsletter_subscribers` (email unique,
  confirmed_at nullable, unsubscribed_at nullable, created_at).
  Double opt-in: email de confirmacion via Resend antes de
  considerar confirmada la suscripcion.
- [ ] Endpoints publicos: `POST /api/newsletter/subscribe`,
  `GET /api/newsletter/confirm?token=...`,
  `GET /api/newsletter/unsubscribe?token=...`.
  Rate-limit por IP (5/10min) compartiendo el helper de auth.
- [ ] Cron `weekly-digest`: domingos a las 10:00 UTC, top 10
  articulos de la semana (orden por `relevance_score desc` filtrado
  por fecha). Email via Resend a todos los `confirmed_at != null
  AND unsubscribed_at = null`.
- [ ] Formulario de suscripcion dentro de la seccion "Suscribete"
  del /about (junto a los badges de RSS + canales sociales).

### Criterio de cierre Fase 8

1. Un articulo nuevo `classified` con `relevance_score >= 0.75`
   aparece automaticamente en las 3 plataformas del broadcaster
   dentro de los 30min siguientes al classify, sin intervencion.
2. Si Mastodon esta caido, Bluesky y Telegram siguen publicando.
   Al volver Mastodon, el siguiente tick recoge los pendientes.
3. Las 3 cuentas del producto (`@kernelia` en cada plataforma)
   tienen al menos 5 posts publicados y se ven coherentes.
4. Cualquier card del feed publico tiene botones de compartir
   funcionales sin requerir cuentas en redes propietarias.
5. Un visitante puede suscribirse a la newsletter desde `/about`
   y recibe el digest del domingo siguiente sin pasos manuales.
6. `/api/stats` devuelve JSON consistente en <1s y es scrapeable
   por terceros (CORS abierto, sin auth).
7. PLAN.md actualizado, fila #8 marcada `done`, env vars
   documentadas en `.env.example` y configuradas en Vercel
   Production.

---

## Notas

- Cada fase abre una rama canonica (`feature/phase-N-...`) y se cierra con PR a `main`.
- Al cerrar una fase: actualizar tabla de estado, marcar checkboxes, anadir notas con commit/PR ref.
- Si una fase necesita dividirse, anadir subtarea en la fase correspondiente, no crear fases nuevas.
