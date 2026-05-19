<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Issues][issues-shield]][issues-url]
[![License][license-shield]][license-url]
[![Release][release-shield]][release-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <h1>
    <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDQ2MCA0NzAiIGZpbGw9IiMyZGQ0YmYiPjxwb2x5Z29uIHBvaW50cz0iMzc3LDc0IDMxNiw3NCAxNjcsMjQwIDE2NywxNzggMTI1LDE3OCAxMjUsMzUxIi8+PHBvbHlnb24gcG9pbnRzPSIyMTAsMjkxIDMxMSwzOTAgMzcyLDM5MCAyNDAsMjU5Ii8+PC9zdmc+" alt="" style="vertical-align: middle; margin-right: 6px;" />
    Kernelia
  </h1>

  <p align="center">
    Agregador de noticias sobre Inteligencia Artificial, clasificadas y resumidas automáticamente.
    <br />
    <a href="https://kernelia.dev"><strong>kernelia.dev »</strong></a>
    ·
    <a href="#uso">Documentación</a>
    <br />
    <br />
    <a href="https://github.com/raulfdeztdo/kernelia/issues">Reportar Bug</a>
    ·
    <a href="https://github.com/raulfdeztdo/kernelia/issues">Solicitar Funcionalidad</a>
  </p>

  <img src="./media/banner2.png" alt="Kernelia banner" width="100%" style="border-radius:8px; margin-bottom:12px;" />

  <p align="center">
    <img src="https://img.shields.io/badge/Next.js-15-000000?style=flat&logo=nextdotjs&logoColor=white" alt="Next.js" />
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black" alt="React" />
    <img src="https://img.shields.io/badge/Tailwind-4-38BDF8?style=flat&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
    <img src="https://img.shields.io/badge/Supabase-3FCF8E?style=flat&logo=supabase&logoColor=white" alt="Supabase" />
    <img src="https://img.shields.io/badge/Drizzle-C5F74F?style=flat&logo=drizzle&logoColor=black" alt="Drizzle ORM" />
    <img src="https://img.shields.io/badge/Cerebras-F05032?style=flat&logoColor=white" alt="Cerebras" />
    <img src="https://img.shields.io/badge/Vercel-000000?style=flat&logo=vercel&logoColor=white" alt="Vercel" />
    <img src="https://img.shields.io/badge/pnpm-F69220?style=flat&logo=pnpm&logoColor=white" alt="pnpm" />
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details open>
  <summary>Tabla de contenidos</summary>
  <ol>
    <li><a href="#sobre-el-proyecto">Sobre el proyecto</a></li>
    <li><a href="#stack">Stack</a></li>
    <li>
      <a href="#primeros-pasos">Primeros pasos</a>
      <ul>
        <li><a href="#prerrequisitos">Prerrequisitos</a></li>
        <li><a href="#instalación">Instalación</a></li>
        <li><a href="#variables-de-entorno">Variables de entorno</a></li>
      </ul>
    </li>
    <li><a href="#uso">Uso</a></li>
    <li><a href="#funcionalidades">Funcionalidades</a></li>
    <li><a href="#desarrollo">Desarrollo</a></li>
    <li><a href="#cómo-funciona">Cómo funciona</a></li>
    <li><a href="#estado-del-proyecto">Estado del proyecto</a></li>
    <li><a href="#licencia">Licencia</a></li>
    <li><a href="#contacto">Contacto</a></li>
  </ol>
</details>

## Sobre el proyecto

Cada día salen decenas de novedades sobre Inteligencia Artificial repartidas por blogs, medios y feeds de empresas. Mantenerse al día sin sobrecargarse es difícil: una parte del contenido se repite, otra es ruido y lo verdaderamente relevante se pierde en el medio.

**Kernelia** recopila publicaciones de medios de referencia sobre IA, las deduplica, las clasifica por categoría y genera un resumen breve mediante un agente IA. La web pública muestra las noticias más recientes primero, con filtros por categoría y búsqueda libre. Sin login: cualquiera puede visitarla. Las más relevantes se publican automáticamente en Mastodon, Bluesky y Telegram.

### ¿Por qué este proyecto?

- **Sin ruido** — Las noticias se clasifican en 10 categorías concretas y se resumen, para escanear el feed en segundos.
- **Auto-mantenido** — Un cron ingesta nuevas publicaciones cada 3h, el agente IA las clasifica cada 30min y el broadcaster las distribuye a redes sociales sin intervención humana.
- **Bilingüe** — Interfaz nativa en español e inglés. Títulos y resúmenes generados en ambos idiomas por el agente.
- **Newsletter semanal** — Digest opcional cada domingo con los artículos más relevantes de la semana.
- **Coste cero** — Stack íntegramente en planes gratuitos (Vercel + Supabase + Cerebras + Resend).

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15 (App Router, RSC) |
| Lenguaje | TypeScript estricto |
| UI | Tailwind v4 + shadcn/ui |
| i18n | next-intl (ES default, EN) |
| Base de datos | Supabase Postgres |
| ORM | Drizzle |
| LLM | Cerebras `llama3.1-8b` — SDK OpenAI-compatible |
| Ingesta | rss-parser |
| Validación | Zod |
| Auth (backoffice) | Email + bcrypt, cookie HMAC `__Host-` |
| Email | Resend (confirmación newsletter + password reset) |
| Broadcaster | Mastodon · Bluesky · Telegram |
| Hosting | Vercel (Hobby) |
| Cron | GitHub Actions (cada 3h ingest, cada 30min classify + broadcast) |
| Tests | Vitest + Playwright |

## Primeros pasos

### Prerrequisitos

- [Node.js](https://nodejs.org) 22 LTS
- [pnpm](https://pnpm.io) 11 o superior (`npm install -g pnpm`)
- Una cuenta de [Supabase](https://supabase.com) (free tier)
- Una API key de [Cerebras](https://cloud.cerebras.ai) (free tier)
- Una cuenta de [Resend](https://resend.com) con dominio verificado (para newsletter y password reset)

### Instalación

```bash
git clone https://github.com/raulfdeztdo/kernelia.git
cd kernelia
pnpm install
cp opencode.example.jsonc opencode.jsonc   # si usas opencode
```

### Variables de entorno

Copia la plantilla y rellena los valores reales:

```bash
cp .env.example .env.local
```

**Base de datos:**
- `DATABASE_URL` — Connection string del **transaction pooler** de Supabase (puerto 6543), usado en runtime.
- `DATABASE_URL_DIRECT` — Connection string del **session pooler** (puerto 5432), usado por `drizzle-kit` para migraciones.

**LLM:**
- `CEREBRAS_API_KEY` — Generada en [cloud.cerebras.ai](https://cloud.cerebras.ai).
- `CEREBRAS_MODEL` — Modelo a usar (default: `llama3.1-8b`).

**Cron:**
- `CRON_SECRET` — Genera uno con `openssl rand -hex 32`. Protege los endpoints `/api/cron/*`.

**Backoffice admin:**
- `SESSION_SECRET` — Mínimo 32 caracteres. Firma las cookies de sesión HMAC.
- `INITIAL_ADMIN_EMAIL` — Email del primer administrador (el seed lo crea si no existe ningún usuario).

**Email (Resend):**
- `RESEND_API_KEY` — Generada en [resend.com](https://resend.com).
- `EMAIL_FROM` — Dirección remitente verificada, p.ej. `Kernelia <newsletter@kernelia.dev>`.

**Broadcaster (opcional):**
- `MASTODON_INSTANCE_URL` y `MASTODON_ACCESS_TOKEN` — Cuenta bot en Mastodon.
- `BLUESKY_IDENTIFIER` y `BLUESKY_APP_PASSWORD` — Cuenta bot en Bluesky.
- `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` — Bot y canal de Telegram.
- `BROADCAST_ENABLED` — `true` para activar. `false` para pausar sin redeploy.
- `BROADCAST_MIN_RELEVANCE_SCORE` — Umbral mínimo (default: `0.75`).

**Sitio público:**
- `NEXT_PUBLIC_SITE_URL` — URL pública sin slash final, p.ej. `https://kernelia.dev`.

Aplica el schema y haz el seed inicial:

```bash
pnpm db:migrate   # aplica migraciones SQL
pnpm db:seed      # carga categorías, fuentes RSS y el primer usuario admin
```

## Uso

```bash
# Servidor de desarrollo
pnpm dev
```

Abre `http://localhost:3000` y verás la home en español. Cambia a inglés desde el selector del header o navegando a `/en`.

El backoffice está en `/admin` — primer acceso por el flujo de "olvidaste contraseña" con el email configurado en `INITIAL_ADMIN_EMAIL`.

Para disparar manualmente los crons:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/classify?limit=10
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/broadcast
```

## Funcionalidades

**Feed público:**
- **Listado de noticias** — Ordenado por fecha descendente, paginación append-style (sin recarga).
- **Filtros por categoría** — Multi-selección: LLMs, agentes, investigación, productos, robótica, regulación, seguridad, multimodal, coding AI, otros.
- **Búsqueda libre** — Por palabras clave en título y resumen, con debounce en cliente e `ILIKE` en servidor.
- **UI bilingüe** — Español por defecto, inglés disponible. Títulos y resúmenes generados en ambos idiomas.
- **SEO** — Metadata por locale (OG, canonical, hreflang + x-default), `sitemap.xml`, `robots.txt`.
- **RSS** — `/rss.xml?lang=es|en` con los últimos artículos clasificados.
- **Stats públicas** — `/api/stats` con métricas abiertas (artículos, tokens, actividad).
- **Share buttons** — Copiar enlace, compartir por email, compartir en Mastodon.
- **Newsletter** — Suscripción opcional con double opt-in. Digest semanal cada domingo.

**Pipeline automático:**
- **Ingesta** — Cada 3h lee 10+ fuentes RSS, normaliza URLs, deduplica por hash SHA-256.
- **Clasificación** — Cada 30min procesa lotes de artículos `pending` con Cerebras: categoría + resumen en ES y EN + relevance score, validados con Zod antes de persistir. Cola round-robin por fuente para evitar monopolios.
- **Broadcaster** — Publica artículos con `relevance_score >= 0.75` en Mastodon, Bluesky y Telegram. Idempotencia por `(article_id, platform)`.

**Backoffice `/admin`:**
- **Auth** — Login por email + contraseña (bcrypt cost 12), cookie HMAC `__Host-kernelia-session`, password reset vía Resend.
- **Dashboard** — Métricas de artículos, categorías, fuentes, tokens y broadcasts con gráficas Recharts.
- **Monitor de cron** — Últimas 50 ejecuciones de ingest, classify, broadcast y newsletter.
- **Gestión de artículos** — Cambiar estado (pending / classified / hidden / failed), reasignar categoría, re-clasificar con un clic.
- **Gestión de usuarios** — Añadir, desactivar o borrar administradores con guardrails (no auto-borrado, nunca cero admins activos).
- **Broadcasts** — Historial y analytics de publicaciones por plataforma.

## Desarrollo

```bash
# Servidor de desarrollo
pnpm dev

# Lint + typecheck
pnpm lint
pnpm typecheck

# Tests
pnpm test          # unit tests (Vitest)
pnpm test:e2e      # end-to-end (Playwright)

# Build de producción
pnpm build

# Base de datos
pnpm db:generate   # genera SQL desde el schema Drizzle
pnpm db:migrate    # aplica migraciones
pnpm db:push       # sync directo schema -> DB (sin migración)
pnpm db:seed       # carga datos iniciales
pnpm db:studio     # GUI local de Drizzle Studio
```

## Cómo funciona

```
  GitHub Actions (cada 3h)          GitHub Actions (cada 30min)
         │                                    │
         │ GET /api/cron/ingest               │ GET /api/cron/classify
         ▼                                    ▼
  ┌─────────────────┐             ┌─────────────────────┐
  │  Fuentes RSS    │──── feeds ─▶│  Ingest              │
  │  (10+ medios)   │             │  - rss-parser        │
  └─────────────────┘             │  - canonicaliza URL  │
                                  │  - hash dedupe       │
                                  └──────────┬───────────┘
                                             │ insert pending
                                             ▼
                                  ┌──────────────────────┐
                                  │  Supabase Postgres    │
                                  │  (Drizzle ORM)        │
                                  └──────┬────────────────┘
                                         │ select pending (round-robin)
                                         ▼
  ┌─────────────────┐         ┌──────────────────────────┐
  │  Cerebras LLM   │◀────────│  Classify agent           │
  │  (llama3.1-8b)  │         │  - prompt + Zod schema   │
  └────────┬────────┘         │  - category + summary    │
           │                  │  - ES + EN + score        │
           └──── classified ──▶  update articles          │
                                  └──────────┬────────────┘
                                             │ relevance_score >= 0.75
                                             ▼
                                  ┌──────────────────────┐
                                  │  Broadcaster          │
                                  │  - Mastodon           │
                                  │  - Bluesky            │
                                  │  - Telegram           │
                                  └──────────────────────┘
                                             │
                                             ▼
                                  ┌──────────────────────┐
                                  │  Next.js (App Router) │
                                  │  - RSC + i18n         │
                                  │  - filtros + búsqueda │
                                  │  - RSS + sitemap      │
                                  │  - /admin backoffice  │
                                  └──────────────────────┘
```

El frontend solo lee. La ingesta, clasificación y distribución viven en endpoints protegidos por `CRON_SECRET` que GitHub Actions invoca periódicamente. Toda la lógica de dominio está en `lib/ingest/`, `lib/ai/` y `lib/broadcast/`, separada de la capa de UI.

## Estado del proyecto

El plan de ejecución vivo está en [`PLAN.md`](./PLAN.md).

| Fase | Estado |
|------|--------|
| 0 — Limpieza y rebranding | ✅ done |
| 1 — Bootstrap Next.js | ✅ done |
| 2 — Modelo de datos e ingesta RSS | ✅ done |
| 3 — Agente IA (Cerebras) | ✅ done |
| 4 — Web: listado, filtros, búsqueda | ✅ done |
| 5 — Pulido, SEO, accesibilidad | ✅ done |
| 6 — Release v0.1.0 a producción | ✅ done |
| 7 — Backoffice admin (auth + panel) | ✅ done |
| 8 — Distribución y propagación | ⏳ in progress |

## Licencia

Distribuido bajo la licencia MIT. Ver `LICENSE` para más información.

## Contacto

Raúl Fernández Tirado — [@raulfdeztdo](https://github.com/raulfdeztdo)

Repositorio: [https://github.com/raulfdeztdo/kernelia](https://github.com/raulfdeztdo/kernelia)

<!--
  MARKDOWN LINKS & IMAGES
  The `&_=v010` is a cache-buster: GitHub proxies external images via
  Camo and caches each unique URL for up to ~1h. When the release badge
  rendered "no releases" before we tagged v0.1.0, that response stuck
  even after tagging. Appending a versioned param forces GitHub to
  generate a new Camo signature on next push, bypassing the stale cache.
  Bump `v010` on subsequent releases if a badge looks stale.
-->
[contributors-shield]: https://img.shields.io/github/contributors/raulfdeztdo/kernelia.svg?style=for-the-badge&_=v010
[contributors-url]: https://github.com/raulfdeztdo/kernelia/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/raulfdeztdo/kernelia.svg?style=for-the-badge&_=v010
[forks-url]: https://github.com/raulfdeztdo/kernelia/network/members
[issues-shield]: https://img.shields.io/github/issues/raulfdeztdo/kernelia.svg?style=for-the-badge&_=v010
[issues-url]: https://github.com/raulfdeztdo/kernelia/issues
[license-shield]: https://img.shields.io/github/license/raulfdeztdo/kernelia.svg?style=for-the-badge&cacheSeconds=0&_=v010
[license-url]: https://github.com/raulfdeztdo/kernelia/blob/main/LICENSE
[release-shield]: https://img.shields.io/github/v/release/raulfdeztdo/kernelia?style=for-the-badge&color=purple&_=v010
[release-url]: https://github.com/raulfdeztdo/kernelia/releases/latest
