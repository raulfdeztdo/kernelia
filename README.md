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

**Kernelia** recopila publicaciones de medios de referencia sobre IA, las deduplica, las clasifica por categoría y genera un resumen breve mediante un agente IA. La web pública muestra las noticias más recientes primero, con filtros por categoría y búsqueda libre por palabras clave. Sin login: cualquiera puede visitarla.

### ¿Por qué este proyecto?

- **Sin ruido** — Las noticias se clasifican en categorías concretas y se resumen, para que se pueda escanear el feed en segundos.
- **Auto-mantenido** — Un cron ingesta nuevas publicaciones cada pocas horas y el agente IA las procesa sin intervención humana.
- **Bilingüe** — Interfaz nativa en español e inglés con selector de idioma.
- **Coste cero** — Stack pensado para correr íntegramente en planes gratuitos (Vercel + Supabase + Cerebras).

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15 (App Router, RSC) |
| Lenguaje | TypeScript estricto |
| UI | Tailwind v4 + shadcn/ui |
| i18n | next-intl (ES default, EN) |
| Base de datos | Supabase Postgres |
| ORM | Drizzle |
| LLM | Cerebras (Llama 3.3 70B) — SDK OpenAI-compatible |
| Ingesta | rss-parser |
| Validación | Zod |
| Hosting | Vercel (Hobby) |
| Cron | Vercel Cron |
| Tests | Vitest + Playwright |

## Primeros pasos

### Prerrequisitos

- [Node.js](https://nodejs.org) 20 o superior
- [pnpm](https://pnpm.io) 11 o superior (`npm install -g pnpm`)
- Una cuenta de [Supabase](https://supabase.com) (free tier)
- Una API key de [Cerebras](https://cloud.cerebras.ai) (free tier)

### Instalación

```bash
git clone https://github.com/raulfdeztdo/kernelia.git
cd kernelia
pnpm install
```

### Variables de entorno

Copia la plantilla y rellena los valores reales:

```bash
cp .env.example .env.local
```

Necesitas:

- `DATABASE_URL` — Connection string del **transaction pooler** de Supabase (puerto 6543), usado en runtime.
- `DATABASE_URL_DIRECT` — Connection string del **session pooler** (puerto 5432), usado por `drizzle-kit` para migraciones.
- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Para acceso público de lectura.
- `SUPABASE_SERVICE_ROLE` — Solo server-side, nunca exponer al cliente.
- `CEREBRAS_API_KEY` — Generada en [cloud.cerebras.ai](https://cloud.cerebras.ai).
- `CRON_SECRET` — Genera uno con `openssl rand -hex 32`. Protege los endpoints de cron.

Aplica el schema y haz el seed inicial:

```bash
pnpm db:migrate   # aplica migraciones SQL
pnpm db:seed      # carga categorías y 10 fuentes RSS iniciales
```

## Uso

```bash
# Servidor de desarrollo
pnpm dev
```

Abre `http://localhost:3000` y verás la home en español. Cambia a inglés desde el selector del header o navegando a `/en`.

Para disparar manualmente la ingesta:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest
```

Devuelve un resumen JSON con artículos obtenidos, insertados y errores por fuente.

## Funcionalidades

- **Listado de noticias** — Ordenado por fecha de publicación descendente, con paginación.
- **Filtros por categoría** — Multi-selección server-side. Categorías: LLMs, agentes, investigación, productos, robótica, regulación, seguridad/alineamiento, multimodal, coding AI, otros.
- **Búsqueda libre** — Por palabras clave en título y resumen, con debounce en el cliente y `ILIKE` en el servidor.
- **UI bilingüe** — Español por defecto, inglés disponible. Selector en el header. El idioma se persiste en cookie.
- **Modo claro y oscuro** — Automático según preferencias del sistema.
- **Ingesta automatizada** — Cron de Vercel que lee 10 fuentes RSS, normaliza URLs, deduplica por hash SHA-256 y persiste artículos como `pending`.
- **Agente IA** — Procesa lotes de artículos `pending` y los clasifica + resume usando Cerebras con structured output validado por Zod.
- **Dedupe robusto** — URLs canonicalizadas (elimina parámetros `utm_*`, `fbclid`, etc., ordena query params, normaliza host).
- **API protegida** — Endpoints `/api/cron/*` requieren `Authorization: Bearer ${CRON_SECRET}`.

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
                                    ┌──────────────────────┐
                                    │   Vercel Cron         │
                                    │   (cada 3 h)          │
                                    └──────────┬───────────┘
                                               │ POST /api/cron/ingest
                                               ▼
   ┌─────────────────────┐         ┌──────────────────────┐
   │  Fuentes RSS        │────────▶│  Ingest agent         │
   │  (10 medios IA)     │  feeds  │  - rss-parser         │
   └─────────────────────┘         │  - canonicaliza URL   │
                                   │  - hash dedupe        │
                                   └──────────┬───────────┘
                                              │ insert pending
                                              ▼
                                   ┌──────────────────────┐
                                   │  Supabase Postgres    │
                                   │  (Drizzle ORM)        │
                                   └──────────┬───────────┘
                                              │ select pending
                                              ▼
   ┌─────────────────────┐         ┌──────────────────────┐
   │  Cerebras LLM       │◀────────│  Classify agent       │
   │  (Llama 3.3 70B)    │         │  - prompt + schema    │
   └──────────┬──────────┘         │  - Zod validation     │
              │ category + summary └──────────┬───────────┘
              ▼                               │ update classified
   ┌──────────────────────────────────────────▼───────────┐
   │                  Supabase Postgres                    │
   └──────────────────────┬───────────────────────────────┘
                          │ select desc
                          ▼
                ┌──────────────────────┐
                │  Next.js (App Router) │
                │  - RSC + i18n         │
                │  - filtros + búsqueda │
                └──────────────────────┘
```

El frontend solo lee. La ingesta y la clasificación viven en endpoints protegidos por `CRON_SECRET` que Vercel Cron invoca de forma periódica. Toda la lógica de dominio está en `lib/ingest/` y `lib/ai/`, separada de la capa de UI.

## Estado del proyecto

En construcción. El plan de ejecución vivo está en [`PLAN.md`](./PLAN.md).

| Fase | Estado |
|------|--------|
| 0 — Limpieza y rebranding | ✅ done |
| 1 — Bootstrap Next.js | ✅ done |
| 2 — Modelo de datos e ingesta RSS | ✅ done |
| 3 — Agente IA (Cerebras) | ⏳ pending |
| 4 — Web: listado, filtros, búsqueda | ⏳ pending |
| 5 — Pulido, SEO, accesibilidad | ⏳ pending |
| 6 — Release v0.1.0 a producción | ⏳ pending |

## Licencia

Distribuido bajo la licencia MIT. Ver `LICENSE` para más información.

## Contacto

Raúl Fernández Tirado — [@raulfdeztdo](https://github.com/raulfdeztdo)

Repositorio: [https://github.com/raulfdeztdo/kernelia](https://github.com/raulfdeztdo/kernelia)

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/raulfdeztdo/kernelia.svg?style=for-the-badge
[contributors-url]: https://github.com/raulfdeztdo/kernelia/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/raulfdeztdo/kernelia.svg?style=for-the-badge
[forks-url]: https://github.com/raulfdeztdo/kernelia/network/members
[issues-shield]: https://img.shields.io/github/issues/raulfdeztdo/kernelia.svg?style=for-the-badge
[issues-url]: https://github.com/raulfdeztdo/kernelia/issues
[license-shield]: https://img.shields.io/github/license/raulfdeztdo/kernelia.svg?style=for-the-badge&cacheSeconds=0
[license-url]: https://github.com/raulfdeztdo/kernelia/blob/main/LICENSE
[release-shield]: https://img.shields.io/github/v/release/raulfdeztdo/kernelia?style=for-the-badge&color=purple
[release-url]: https://github.com/raulfdeztdo/kernelia/releases/latest
