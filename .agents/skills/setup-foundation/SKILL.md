---
name: setup-foundation
description: Base de conocimiento para materializar o alinear la base técnica del proyecto a partir de decisiones ya tomadas por arquitectura.
---

# setup-foundation

## Objetivo
Dar criterios para que `setup-agent` pueda materializar o alinear la base técnica de un proyecto sin redecidir arquitectura, ejecutando una sola vez por baseline aprobado.

## Modos de trabajo
### Greenfield
- Partir del DD aprobado.
- Trabajar sobre la síntesis del baseline completo de la primera iteración, no sobre un FR aislado.
- Heredar el mismo contexto global que usó `arch-agent` para decidir la base técnica.
- Materializar solo la base técnica definida por arquitectura.
- Priorizar simplicidad, trazabilidad y capacidad de evolucion.
- Si el DD no define suficiente para arrancar, bloquear y devolver feedback a arquitectura.

### Existing project
- Inspeccionar la estructura real del repo completo.
- Heredar el mismo contexto global que usó `arch-agent` para evaluar la continuidad arquitectónica.
- Detectar herramientas, scripts, convenciones y stack dominante.
- Reflejar la realidad existente en `coding-principles.md`.
- Evitar reestructuraciones grandes salvo aprobación explícita.
- Alinear la base técnica al DD sin inventar una arquitectura nueva.

## Que debe producir
- Base técnica mínima lista para avanzar.
- `coding-principles.md` alineado con el proyecto real.
- Confirmacion de que setup ha quedado resuelto para ese baseline y no necesita repetirse por cada FR o DD slice.
- Lista corta de supuestos validados, límites conocidos y gaps que deban volver a arquitectura.
