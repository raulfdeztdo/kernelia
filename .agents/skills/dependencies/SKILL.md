---
name: dependencies
description: Política para proponer, evaluar y aprobar cambios de dependencias sin introducir librerías innecesarias ni versiones arbitrarias.
---

# Dependencies

## Objetivo
Mantener el arbol de dependencias bajo control y justificar cualquier cambio en manifests o lockfiles.

## Principios
- No añadir, actualizar o eliminar dependencias sin aprobación humana explícita.
- Proponer una opcion principal y justificar por que resuelve el problema.
- Preferir la ultima version estable compatible cuando el cambio este aprobado.
- Si el proyecto ya tiene una libreria que cubre el caso, reutilizarla antes de sumar otra.

## Evaluar antes de proponer
- Que problema real resuelve.
- Si existe capacidad equivalente ya instalada.
- Riesgo de peso, complejidad, lock-in o mantenimiento.
- Impacto en build, runtime, licencias o DX.

## Anti-patrones
- Anadir librerias por comodidad para problemas pequenos.
- Fijar versiones arbitrarias sin razón.
- Mezclar en el mismo cambio la necesidad técnica y la aprobación pendiente.
