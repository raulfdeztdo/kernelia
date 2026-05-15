# Coding Principles — Kernelia

Refleja el proyecto real. Si una decision cambia en codigo, este documento se actualiza en el mismo PR.

## 1. Contexto del proyecto

- Modo: `greenfield`.
- Tipo: aplicacion web publica, sin auth, agregador de noticias IA con clasificacion automatica.
- Restricciones:
  - Coste objetivo: free tier (Vercel Hobby, Supabase Free, Cerebras free).
  - Bilingue ES/EN desde el dia 1.
  - SEO-friendly (RSC + metadata por locale).

## 2. Topologia del repositorio

- Monorepo simple (single Next.js app). Sin workspaces.
- Raiz unica.
- Convencion de rutas:
  - `app/` — App Router (paginas, layouts, route handlers).
  - `app/[locale]/` — paginas publicas con segmento de locale.
  - `app/admin/` — backoffice privado (sin segmento locale, copy en ES).
    `noindex,nofollow` y fuera del sitemap. Toda la rama requiere sesion
    valida; la unica excepcion es `/admin/login` y `/admin/auth/callback`.
  - `app/api/` — route handlers (cron, health, admin).
  - `app/api/admin/` — endpoints internos del backoffice (magic-link,
    sessions, gestion de articulos y usuarios).
  - `lib/` — utilidades compartidas (clients, helpers).
  - `lib/ai/` — cliente Cerebras + prompts + schemas Zod.
  - `lib/ingest/` — RSS parser, dedupe, normalizacion.
  - `lib/auth/` — tokens magic-link, sesiones HMAC, rate-limit, helpers
    de cookie. **Server-only**; nunca importar desde componentes cliente.
  - `lib/email/` — wrapper minimo sobre Resend (`sendMagicLink`).
  - `db/` — schema Drizzle, migraciones, queries.
  - `db/queries/` — unico punto de acceso a la DB. Incluye
    `users.ts`, `cron-runs.ts` y (en sub-fases siguientes)
    `admin-articles.ts`.
  - `components/` — UI (server y client components).
  - `components/ui/` — primitivos shadcn/ui.
  - `messages/` — `es.json`, `en.json` para next-intl.
  - `tests/` — Vitest unit, Playwright e2e.

## 3. Stack principal

- Lenguaje: **TypeScript** estricto (`"strict": true`, `noUncheckedIndexedAccess: true`).
- Runtime: Node 22 LTS (Vercel default).
- Framework: **Next.js 15** App Router.
- Package manager: **pnpm**.
- Build: Next.js builtin. Lint: ESLint (config Next) + Prettier.
- UI: **Tailwind v4** + **shadcn/ui**.
- i18n: **next-intl**.
- ORM: **Drizzle** + `drizzle-kit` para migraciones.
- DB: **Supabase Postgres** (connection pool por `postgres` driver).
- LLM: **Cerebras** via SDK OpenAI-compatible (`openai` npm con `baseURL` de Cerebras).
- Validacion: **Zod**.
- Ingesta: `rss-parser`, `cheerio` (parseo de HTML cuando haga falta enriquecer).
- Tests: **Vitest** (unit), **Playwright** (e2e).

## 4. Arquitectura de software

- Patron: **Next.js feature-folders** + capa fina de servicios.
- Limites:
  - **UI** (componentes y paginas) no accede directo a la DB; pasa por `db/queries/*`.
  - **API routes / server actions** orquestan, no contienen logica de negocio compleja.
  - **`lib/ai`**, **`lib/ingest`** y **`db/queries`** son los modulos de dominio.
- Sin DI explicita ni hexagonal: solo modulos con bordes claros.
- Errores: tipos discriminados (`Result<T, E>`) en logica de ingesta y agente IA; `throw` en handlers HTTP solo en errores no recuperables.

## 5. Datos e integraciones

- DB: Postgres en Supabase. Drizzle schema en `db/schema.ts`.
- Migraciones: `drizzle-kit generate` -> `drizzle-kit migrate`. Commit de migraciones SQL al repo.
- Seeds: `db/seed.ts` con fuentes RSS iniciales y categorias canonicas.
- Integraciones externas:
  - Feeds RSS de medios IA (lista en `db/seed.ts`).
  - Cerebras API (clasificacion + resumen).
- Dedupe: hash SHA-256 de `url` canonica + `published_at` truncado a hora.

## 6. Testing

- Vitest para unit (logica de ingesta, parsing, schema Zod, helpers).
- Playwright para e2e (carga de home en `/es` y `/en`, filtro por categoria, busqueda).
- TDD donde aporte (parsing y agente IA). Para UI estatica no se exige RED-GREEN previo.
- Cobertura no medida por umbral; se exige test sobre cualquier helper con logica no trivial.
- Comandos canonicos: `pnpm test`, `pnpm test:e2e`.

## 7. Frontend

- Routing: App Router con segmento `[locale]`.
- Estado: Server Components por defecto. Estado de cliente solo cuando aporta (filtros, input de busqueda con debounce).
- Sin libreria de estado global hasta que se demuestre necesario.
- i18n: ver skill `i18n`.
- Estilos: Tailwind utility-first. Variantes con `cva` cuando se repita un patron.
- Componentes: server por defecto; `"use client"` solo cuando hace falta interactividad.

## 8. Backend

- Capas: `route handler -> service (lib/*) -> queries (db/queries/*)`.
- Politica de errores: log estructurado (`pino` o `console.error` con prefijo) en server; nunca exponer stack al cliente.
- Contratos: schemas Zod compartidos entre route handlers y consumidores.
- Seguridad:
  - Cron protegido por `CRON_SECRET` en header (`Authorization: Bearer ...`).
  - Service role key de Supabase **solo** en server (`process.env.SUPABASE_SERVICE_ROLE`).
  - Anon key para lectura publica desde el cliente si se requiere.
  - **Admin (Fase 7):** auth solo en `/admin/*`. Cookie `__Host-kernelia-session`
    firmada con HMAC (`SESSION_SECRET`, >= 32 chars). Magic-link via Resend:
    token plaintext en el email, en DB solo SHA-256 + `expires_at` (15min) +
    `used_at` para single-use. Rate-limit in-memory por IP **y** por email
    (5 / 10 min) en el endpoint de magic-link. La respuesta del endpoint
    es constante (sin pista de si el email existe) para evitar enumeracion.
- Rate limit en endpoints de busqueda si llegan a publico (no urgente).

## 9. CI/CD

- Comandos canonicos:
  - `pnpm install`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- CI: GitHub Actions sobre cada PR (lint + typecheck + test + build).
- Deploy: Vercel auto-deploy de `main`. Previews por PR.
- Cron: `vercel.json` con jobs apuntando a `/api/cron/*` y header con `CRON_SECRET`.
- Release: tag `vX.Y.Z` cuando se promueva una version notable (ver `PLAN.md`).

## 10. Regla de calidad

- Ningun agente asume estructura que este documento no defina.
- Cambios estructurales pasan por `arch-agent` y actualizan este documento en el mismo PR.
