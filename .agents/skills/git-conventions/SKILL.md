---
name: git-conventions
description: Reglas de ramas, commits y PR para trabajar con una rama canónica de feature y GitHub.
---

# Git Conventions

## Objetivo
Estandarizar ramas, commits y PRs sin acoplar el flujo a archivos de estado obsoletos.

## Reglas
- Nunca commit directo a `main`.
- Siempre PR a `main`.
- Conventional Commits para los commits visibles.
- La rama canónica de feature la define `tech-agent`.
- Los worktrees de tarea se reintegran en la rama canónica antes del release.
- Una PR por rama canónica por defecto.

## Convenciones
- Rama canónica: `feat/<slug>` o `fix/<slug>`
- Commit: `type(scope): short description`
- PR: resumen claro, contexto suficiente y artefactos relevantes

## Resultado esperado
- Historial legible.
- PR clara y lista para revision humana.
- Sin dependencias a `STATUS.md` ni archivos de progreso locales.
