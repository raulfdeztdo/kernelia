---
name: worktree-management
description: Reglas para trabajar con ramas canónicas de feature y worktrees efímeros por tarea.
---

# worktree-management

## Objetivo
Estandarizar cómo se usan worktrees para implementar tareas pequeñas sin pisarse trabajo entre agentes.

## Modelo
- Existe una rama canónica por TD o slice implementable creada por `tech-agent`.
- Cada tarea usa un worktree efímero propio.
- El worktree nace desde la rama canónica y se reintegra a ella al terminar.
- Si hay tareas en paralelo, el TD debe dejar claro si comparten o no write scope y en qué orden se reintegran.

## Convenciones sugeridas
- Rama canónica: `feat/<feature-slug>` o `fix/<feature-slug>`
- Rama/worktree de tarea: derivada de la canónica + slug de tarea
- Ruta local de worktree: `.worktrees/<task-slug>` o equivalente fuera de la raíz

## Reglas
- No trabajar directamente en `main`.
- No mezclar varias tareas en el mismo worktree.
- No dejar worktrees huérfanos tras cerrar la tarea.
- La reintegración debe dejar la rama canónica lista para el siguiente agente.
- No ejecutar en paralelo tareas que compiten por los mismos hotspots sin una estrategia de integración definida.
