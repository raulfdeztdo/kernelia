---
name: error-handling
description: Define un contrato de errores estable entre capas y sistemas usando codigos y metadatos estructurados.
---

# Error Handling

## Objetivo
Mantener errores trazables, tipados y consumibles por otras capas sin acoplar backend y UI a mensajes fragiles.

## Principios
- El error estable es el código, no el texto final.
- Los metadatos del error deben ser estructurados y utiles.
- La UI decide como presentar el error al usuario.

## Shape recomendado
```json
{
  "error": {
    "code": "RESOURCE_CONFLICT",
    "details": {
      "resourceId": "abc123"
    }
  }
}
```

## Backend
- Crear errores de dominio o de aplicación con código estable.
- Mapear esos errores a status y payload de forma centralizada.
- No incrustar mensajes de UX como contrato de API.

## Frontend
- Consumir `code` y `details`.
- Traducir o presentar el error en la capa adecuada.
- Tratar los errores no catalogados como casos excepcionales observables.

## Anti-patrones
- Comparar mensajes literales.
- Devolver strings distintas para el mismo problema según el endpoint.
- Mezclar validación, serialización y UX en una sola capa.
