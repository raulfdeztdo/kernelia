---
name: system-design
description: Criterios para decidir arquitectura de sistema, topología de repositorio y despliegue según el contexto real del proyecto.
---

# System Design

## Objetivo
Ayudar a elegir o respetar la arquitectura adecuada para un proyecto nuevo o existente, separando con claridad sistema, repositorio y despliegue.

## Evaluar siempre
- Tipo de producto y dominio.
- Escala esperada.
- Restricciones operativas y de equipo.
- Integraciones y latencia.
- Complejidad de despliegue.
- Arquitectura ya existente, si la hay.

## Ejes de decision
### Topología del sistema
- Modular monolith
- Servicios separados
- Otra topología justificada

### Topología del repositorio
- Repo unico simple
- Monorepo
- Polyrepo

### Estrategia de despliegue
- Un solo artefacto desplegable
- Varios artefactos desplegables
- Otra estrategia justificada

## Reglas
- No asumir monorepo por defecto.
- No elegir microservicios si el problema no lo justifica.
- No confundir forma del repo con forma del sistema.
- Si el proyecto ya existe, priorizar continuidad y compatibilidad.
- TypeScript es una preferencia fuerte, no una obligacion ciega.

## Que debe producir
- Arquitectura recomendada o arquitectura heredada aceptada para cada eje relevante.
- Razón principal de la decisión.
- Tradeoffs asumidos.
- Límites relevantes para setup y tech.
