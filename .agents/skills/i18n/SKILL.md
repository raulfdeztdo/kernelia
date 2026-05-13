---
name: i18n
description: Criterios para gestionar textos visibles, claves de traduccion y pruebas de internacionalizacion en Kernelia (Next.js + next-intl, ES/EN).
---

# i18n (Kernelia)

## Stack
- **Libreria:** `next-intl` sobre Next.js 15 App Router.
- **Locales soportados:** `es` (default), `en`.
- **Routing:** prefijo de locale en URL (`/es/...`, `/en/...`) con `localePrefix: "as-needed"`.
- **Fuente de mensajes:** `messages/{locale}.json` en la raiz del proyecto.
- **Negociacion inicial:** middleware de `next-intl` lee `Accept-Language` y cookie `NEXT_LOCALE`.

## Objetivo
Garantizar que cada texto visible esta traducido en ES y EN antes de mergear, con claves estables y mantenibles.

## Principios
- Cero texto hardcodeado en componentes (JSX, atributos `aria-*`, `placeholder`, `title`, mensajes de error de UI).
- Cada cambio que toca texto debe actualizar `messages/es.json` y `messages/en.json` en el mismo commit.
- Los textos generados por el LLM (resumenes, categorias) se guardan en el idioma original del articulo; la UI no los traduce — los pinta tal cual con su `lang` correspondiente.
- La traduccion vive en la capa de presentacion. Backend y base de datos no contienen literales de UI.

## Convencion de claves
- Estructura jerarquica por feature: `news.list.empty`, `news.filters.category.label`, `news.card.readMore`.
- Las claves comunes reutilizables van en `common.*` solo cuando son genuinamente transversales (`common.actions.search`, `common.actions.clear`).
- Mensajes con variables usan ICU: `"news.list.count": "{count, plural, one {# noticia} other {# noticias}}"`.
- Fechas se formatean con `useFormatter().dateTime()` de `next-intl`, no con literales.

## Uso en componentes
- Server Components: `import { getTranslations } from "next-intl/server"`.
- Client Components: `import { useTranslations } from "next-intl"`.
- El namespace se pasa al hook: `const t = useTranslations("news.list")`.
- Para `metadata` (SEO, `<title>`, OG), usar `getTranslations` dentro de `generateMetadata`.

## Cambio de idioma
- Selector visible en el header con dos opciones (ES / EN).
- El cambio usa `next-intl`'s `Link` o `useRouter().replace` preservando la ruta actual.
- Persistir eleccion en cookie `NEXT_LOCALE` (1 ano).

## Testing
- Cualquier test de componente que renderice texto debe envolverse con `NextIntlClientProvider` y los mensajes del locale correspondiente.
- Test E2E (Playwright) cubre al menos un flujo en cada locale: cargar `/es` y `/en` y validar elementos clave.
- Lint-rule (script propio o `eslint-plugin-i18next` adaptado) que falle si hay literales en JSX bajo `app/` excluyendo `app/api/`.

## Checklist pre-merge
- [ ] Toda key nueva existe en `es.json` y `en.json`.
- [ ] No hay claves huerfanas (script `pnpm i18n:check`).
- [ ] Plurales y variables usan ICU correctamente.
- [ ] Capturas de la UI en ambos locales si el cambio es visible.

## Anti-patrones
- Claves ambiguas como `common.label` o `common.text`.
- Concatenar strings traducidos: usar interpolacion ICU.
- Traducir contenido dinamico de la base de datos en la UI (los articulos se sirven en su idioma original).
- Dejar un locale "para mas tarde": rompe la promesa bilingue.
