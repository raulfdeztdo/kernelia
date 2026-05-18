# Distribucion upstream — awesome-lists target

Doc operativo para la Fase 8.C. Enumera los awesome-lists donde merece la
pena proponer una entrada para Kernelia, con el formato y el angulo de
encaje que cada uno espera.

La meta NO es perseguir trafico: es estar listado donde un investigador o
ingeniero de IA buscaria un agregador de noticias serio. La marca habla,
el operador no — los PRs van firmados desde la cuenta de GitHub del
proyecto, no desde redes sociales del autor.

## Plantilla de entrada

Casi todos los awesome-lists piden un formato `- [Nombre](URL) — short
description`. Texto base reutilizable (ES y EN):

```
- [Kernelia](https://kernelia.dev) — open-source AI news aggregator.
  Pulls RSS from a curated set of sources, classifies every article into
  one of 10 categories with an open-source LLM, and serves bilingual
  summaries (ES/EN). RSS feeds + Mastodon / Bluesky / Telegram broadcasts.
```

Ajustar la longitud al estilo del list. Si el list pide tags, usar:
`open-source`, `aggregator`, `i18n`, `rss`.

## Listas objetivo

### Tier 1 — encaje directo

Listas donde Kernelia es una entrada natural. Empezar por aqui.

1. **awesome-machine-learning** — github.com/josephmisiti/awesome-machine-learning
   - Seccion sugerida: `## News` (existe).
   - Tono: profesional, frases cortas. No mencionar el broadcaster.
   - PR atomico: una sola linea en una sola seccion.

2. **awesome-artificial-intelligence** — github.com/owainlewis/awesome-artificial-intelligence
   - Seccion sugerida: `Learning` > `News`, o crear sub-seccion `Aggregators` si la lista la acepta.
   - El maintainer cierra PRs duplicados rapido — comprobar que no exista ya un agregador casi identico.

3. **awesome-AI-tutorials** — github.com/d0r1h/awesome-AI-tutorials (y forks activos)
   - No es el mejor encaje, pero tiene seccion `Newsletters`.

4. **awesome-llm** — github.com/Hannibal046/Awesome-LLM
   - Seccion `News` o `Resources`. Aceptan aggregators si dejan claro que cubren LLMs como categoria (`llm` es uno de nuestros 10 slugs canonicos).

5. **awesome-spanish-nlp / awesome-spanish-ai** — varios forks.
   - Encaje fuerte por bilinguismo (`es` es default). Pocos agregadores cubren ES nativo, eso es nuestra ventaja diferencial aqui.

### Tier 2 — encaje secundario

Listas mas genericas o tematicas donde Kernelia entra solo en sub-secciones concretas.

6. **awesome-news** — github.com/iamadamdev/awesome-news
   - Seccion `Aggregators` o `Technology`. Marca Kernelia como `niche: AI`.

7. **awesome-open-source-newsletters** — varios repos.
   - Reservar para 8.C.2 cuando la newsletter Resend este viva.

8. **awesome-rss-feeds** — github.com/plenaryapp/awesome-rss-feeds
   - El RSS publico (`/rss.xml?lang=es` y `/rss.xml?lang=en`) son la entrada — no la web. Listar bajo `Technology` con ambos feeds.

9. **awesome-open-source-projects** y variantes — listar bajo `next.js` o `supabase` si la lista permite tagging por stack.

### Tier 3 — comunidades y agregadores externos

No son PRs a repos sino registros / submissions.

10. **Hacker News** — `Show HN` cuando 8.C.2 (newsletter) este viva. Una sola oportunidad — esperar a que el feed publique al menos 60 dias para que la home no este vacia.
11. **Lobsters** — invite-only, omitir salvo que alguien del operador tenga invite.
12. **Reddit** — `r/MachineLearning` (regla 5 de baja toleranica con self-promotion: solo `[D]iscussion` posts si hay algo interesante que decir, nunca `[Project]` puro), `r/artificial`, `r/LocalLLaMA`.
13. **Mastodon hashtags** — el broadcaster bot ya los empuja: `#AI`, `#MachineLearning`, `#LLM`. No accion manual.
14. **Producthunt** — escaparate equivocado para una herramienta sin login ni features. Saltar.

## Reglas para los PRs

- Una entrada por PR. Ningun maintainer aprueba PRs que tocan 3 secciones.
- Ordenar alfabeticamente dentro de la seccion si el list lo hace asi (la mayoria).
- Sin emojis, sin marketing-speak ("revolutionary", "best-in-class"). Las descripciones de los awesome-lists son frases declarativas.
- Si el list usa `awesome-lint` o un linter en CI, ejecutarlo localmente antes de abrir el PR (`npm i -g awesome-lint && awesome-lint`).
- Si el list cierra como "duplicate" un PR pasado de un agregador similar, NO insistir — anotar aqui y pasar al siguiente.

## Seguimiento

Cuando un PR se merge, marcar el list con `[merged YYYY-MM-DD]` aqui. Si
se rechaza, marcar `[declined YYYY-MM-DD: razon]` para no repetir.
