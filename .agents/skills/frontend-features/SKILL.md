---
name: frontend-features
description: Criterios para estructurar un frontend por features, con boundaries claros entre UI, hooks, servicios y estado.
---

# Frontend Features

## Objetivo
Mantener una capa frontend modular, donde cada feature concentre su comportamiento y exponga un boundary claro.

## Principios
- Cortar por dominio funcional, no por tipo de archivo global.
- Exponer solo una API publica minima por feature.
- Mantener separadas presentacion, logica de pantalla, acceso a datos y estado compartido.

## Estructura recomendada
- `features/<feature>/components` para UI especifica de la feature.
- `features/<feature>/hooks` para logica de pantalla o coordinacion local.
- `features/<feature>/services` para acceso a API o adaptadores externos de la feature.
- `features/<feature>/types` para contratos propios.
- `features/<feature>/store` cuando exista estado complejo realmente compartido dentro de esa feature.
- `features/<feature>/index.ts` como boundary publico.

## Reglas de boundary
- Una feature no debe importar internals de otra.
- Lo compartido de verdad debe vivir en módulos comunes o publicarse de forma explícita.
- Los componentes puramente visuales y reutilizables no deben quedar atrapados en una feature si el dominio no les pertenece.

## Anti-patrones
- `src/components` o `src/hooks` como cajon global para todo el producto.
- Peticiones HTTP directas desde componentes.
- Features que dependen unas de otras por imports profundos.
- Stores globales para problemas que eran solo de una pantalla.
