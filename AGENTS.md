# AGENTS.md — Punto de entrada

Este archivo solo enruta el trabajo. Las reglas operativas viven en `context-docs/`, en el contrato del agente activo y en las skills que ese agente cargue.

## Proyecto

Kernelia: agregador de noticias IA con clasificacion automatica. Web publica, sin auth, UI bilingue ES/EN. Stack: Next.js 15 + Supabase + Drizzle + Cerebras + Vercel.

## Orden de lectura

1. `context-docs/non-negotiable.md`
2. `context-docs/coding-principles.md`
3. `PLAN.md` (estado actual)
4. Contrato del agente activo
5. Skills aplicables

## Registro de agentes

| Agent ID | File | Cuando entra | Salida principal |
|---|---|---|---|
| `arch-agent` | `.agents/arch-agent.md` | Inicio, cambio de stack o decision estructural | Decision tecnica + tareas implementadoras + ramas |
| `frontend-agent` | `.agents/frontend-agent.md` | Tarea de UI, i18n, filtros, busqueda, paginas | Implementacion frontend + validacion visual |
| `backend-agent` | `.agents/backend-agent.md` | Tarea de ingesta, agente IA, API routes, schema | Implementacion backend en rama canonica |
| `code-review-agent` | `.agents/code-review-agent.md` | Rama canonica lista para gate | APPROVE o BLOCK con evidencia |

## Handoff

1. `arch-agent` define o ajusta la base tecnica y descompone trabajo en tareas concretas.
2. `backend-agent` / `frontend-agent` implementan tareas en su rama canonica.
3. `code-review-agent` revisa antes del merge a `main`.

No hay `pm-agent`, `setup-agent`, `tech-agent`, `design-agent`, ni `devops-agent` separados. Esas responsabilidades se absorben:

- Producto y prioridades: el operador humano + `PLAN.md`.
- Setup tecnico: `arch-agent` en su fase inicial.
- Diseno visual: convencion de `modern-ui-design` + shadcn/ui (sin handoff visual formal).
- Release: PR a `main` -> auto-deploy en Vercel.

## Frontmatter de agentes y skills

- `required_skills`: skills que el agente necesita siempre.
- `optional_skills`: skills que se cargan bajo demanda.
- `mcp_usage`: MCPs realmente esperados para ese agente o skill (solo cuando aporten senal).
