---
name: static-analysis-review
description: Checklist de análisis estático para revisar arquitectura, calidad y deuda técnica antes de aprobar una feature.
---

# Static Analysis Review

## Objetivo
Ampliar el review mas alla de lint y tests.

## Revisar siempre
- Violaciones de arquitectura o boundaries.
- Duplicidades claras.
- Complejidad innecesaria.
- Nombres ambiguos o enganosos.
- Código muerto o ramas imposibles.
- Manejo de errores inconsistente.
- Acoplamientos innecesarios entre módulos.

## Resultado esperado
- Hallazgos accionables con impacto técnico real.
- Distincion entre deuda tolerable y bloqueo de calidad.
