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
| 5 | Pulido, SEO, accesibilidad | **done** | 2026-05-14 | Metadata por locale (OG, canonical, hreflang+x-default). `sitemap.ts`, `robots.ts`, RSS `/rss.xml?lang=es|en`. Pagina `/about` bilingue con fuentes en vivo. `/api/health` con ping DB + counts. `vercel.json` con crons. Skip-link, focus-visible global y `prefers-reduced-motion`. |
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
- [x] `vercel.json`: cron `/api/cron/ingest` cada 3h, `/api/cron/classify?limit=20` cada 30min. Vercel inyecta `Authorization: Bearer ${CRON_SECRET}` automaticamente.
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
- Vercel cron requiere `CRON_SECRET` en el proyecto. El header `Authorization: Bearer ${CRON_SECRET}` lo añade Vercel automaticamente segun la documentacion oficial.

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
