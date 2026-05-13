---
name: testing-practices
description: Buenas prácticas para escribir y revisar tests estables, legibles y de alta señal en backend y frontend.
---

# Testing Practices

## Objetivo
Maximizar confianza técnica con tests que verifiquen comportamiento observable y fallen por razones útiles.

## Principios
- Testear comportamiento, no detalles internos de implementación.
- Mantener aislamiento y datos explicitos.
- Evitar flakiness, temporizaciones frágiles y dependencias del orden de ejecución.
- Hacer que el nombre del test explique escenario y expectativa.
- Seguir el objetivo de cobertura definido por el proyecto, no una cifra inventada por la tarea.

## Backend
- Unit tests: centrar el test en reglas de dominio y casos de uso.
- Integration tests: validar contrato HTTP, persistencia, efectos observables e integraciones reales controladas.
- Los tests de integración deben limpiar estado de forma predecible.

## Frontend
- Priorizar queries semanticas y comportamiento visible al usuario.
- Validar interacciones, estados y contenido final, no la estructura interna del DOM.
- Mantener el acceso a API fuera de los componentes de presentación.
- Probar stores y hooks por sus transiciones de estado, no por detalles privados.

## Anti-patrones
- `.skip` o `.only` versionados.
- Asserts triviales que no ejercen comportamiento real.
- Mocks globales que contaminan otras suites.
- Snapshots gigantes como sustituto de una expectativa concreta.
- Tests que solo pasan por conocer la implementación interna.

## Checklist rápido
- El test falla por la razón correcta cuando el comportamiento se rompe.
- La preparacion es minima y legible.
- Las expectativas describen el contrato observable.
- El dataset del test deja claro el escenario.
