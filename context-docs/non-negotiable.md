# Reglas no negociables

Maxima prioridad. Si una instruccion entra en conflicto con este fichero, el agente debe negarse y nombrar la regla violada.

## 1. Gobernanza del ciclo

- `arch-agent` decide stack y descompone trabajo; los implementadores no toman decisiones estructurales por su cuenta.
- Cambios estructurales se reflejan en `context-docs/coding-principles.md` y en `PLAN.md` en el mismo PR.
- Ninguna fase listada en `PLAN.md` pasa a `done` sin validacion humana explicita.

## 2. Codigo y arquitectura

- TypeScript estricto. `any`, `@ts-ignore`, `as unknown as ...` estan prohibidos salvo justificacion escrita en el PR.
- No mezclar logica de dominio con UI ni con infraestructura.
- UI no consulta la DB directamente; pasa por `db/queries/*`.
- Logica del agente IA y de ingesta vive en `lib/ai` y `lib/ingest`, nunca en componentes.

## 3. i18n

- Cero texto hardcodeado visible en la UI.
- Toda key nueva existe en `es.json` y `en.json` en el mismo commit.
- El contenido dinamico de articulos (titulo, resumen) se sirve en su idioma original; la UI no lo retraduce.

## 4. Testing

- Helpers con logica no trivial (ingesta, parsing, schemas, dedupe) requieren tests.
- `.skip` y `.only` prohibidos en tests versionados.
- E2E minimo: home en `/es` y `/en` carga y muestra articulos.

## 5. Git y release

- Prohibido commitear directamente a `main`.
- Una rama canonica por feature; PR obligatoria a `main`.
- `code-review-agent` da APPROVE antes del merge.
- Vercel auto-deploy a produccion al mergear `main`. Previews por PR.

## 6. Seguridad y secretos

- `.env*` (excepto `.env.example`) nunca se commitean.
- Service role key de Supabase y `CERBRAS_API_KEY` viven solo en el server (env vars).
- Endpoint de cron protegido por `CRON_SECRET` en header.
- Validar respuestas del LLM con Zod antes de persistir.
- **Superficie publica sin auth, backoffice privado en `/admin`** (Fase 7).
  El feed publico (`/[locale]`, `/api/articles`, `rss.xml`, `sitemap.xml`,
  `robots.txt`) sigue siendo lectura libre. `/admin/*` y `/api/admin/*`
  exigen sesion valida (cookie `__Host-kernelia-session` firmada con
  `SESSION_SECRET`). Login por email + contrasenya (bcrypt cost 12);
  Resend solo para enlaces de password-reset. `/admin/*` lleva
  `noindex,nofollow` y queda fuera del sitemap. Nunca loguear contrasenyas
  en plaintext, tokens de password-reset, el valor de la cookie ni el
  plaintext del session id.

## 7. Datos y agente IA

- Fuentes de ingesta declaradas en `db/seed.ts`; no scrapeamos sitios sin RSS sin discusion previa.
- Deduplicar por hash de URL canonica antes de insertar.
- No persistir respuesta del LLM si no valida contra el schema Zod definido.
- Coste y latencia del LLM se loguean por job de ingesta.

## 8. Mejora continua

- Si falta una regla o skill, usar la skill `continuous-improvement`.
- Sugerencias de mejora no se aplican sin revision humana.
