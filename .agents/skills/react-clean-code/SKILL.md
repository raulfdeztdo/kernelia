---
name: react-clean-code
description: Criterios para mantener componentes React pequenos, legibles y bien separados de hooks, servicios y estado.
---

# React Clean Code

## Objetivo
Evitar componentes gigantes y repartir correctamente presentacion, coordinacion y efectos.

## Principios
- El componente de UI debe ser fácil de leer de arriba abajo.
- La logica reusable o compleja debe salir a hooks o servicios.
- El JSX debe describir estructura y comportamiento visible, no ocultar reglas de negocio.

## Reglas prácticas
- Mantener props claras y tipadas.
- Extraer subcomponentes cuando una pieza tenga identidad propia.
- Llevar el acceso a API fuera del componente.
- Resolver transformaciones complejas antes del `return`.

## Señales de deuda
- Componentes que concentran fetch, mapping, validación y render.
- Props ambiguas o objetos gigantes que se pasan de mano en mano.
- Hooks que mezclan demasiadas responsabilidades.
- Componentes que solo se entienden leyendo bloques largos de condicion.
