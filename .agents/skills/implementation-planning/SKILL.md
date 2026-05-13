---
name: implementation-planning
description: Criterios para dividir el trabajo técnico en tareas implementadoras mínimas.
---

# implementation-planning

## Objetivo
Ayudar a cortar una feature en tareas lo más pequeñas posible sin perder coherencia técnica.

## Criterios
- Una tarea debe tener un objetivo técnico verificable.
- Debe minimizar el numero de archivos y responsabilidades tocadas.
- No se divide por capricho: si dos cambios viven en los mismos archivos y no se validan separados, probablemente son una sola tarea.
- No usar por defecto "back" y "front" como unico criterio de corte.
- Solo paralelizar tareas cuando su write scope y su orden de reintegracion sean claros.

## Cada tarea deberia incluir
- título corto,
- objetivo técnico,
- artefactos de entrada,
- alcance exacto,
- impacto,
- dependencias,
- paralelizable: `SI` o `NO`,
- orden de integración,
- worktree slug,
- bloqueo por dependencias externas: `SI` o `NO`,
- criterio de cierre.

## Señales de mala división
- La tarea dura demasiado para revisarse facilmente.
- Mezcla persistencia, API, UI y estados sin necesidad.
- Dos tareas supuestamente paralelas pisan los mismos hotspots sin una serialización explícita.
- El bloqueo por nuevas dependencias aparece por primera vez en implementación.
- Obliga al implementador a descubrir arquitectura por su cuenta.
