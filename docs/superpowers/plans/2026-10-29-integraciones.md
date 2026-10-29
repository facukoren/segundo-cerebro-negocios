# Consultor e Inbound

Objetivo: conectar las pantallas existentes usando credenciales de cada instalación.

Decisiones de implementación: OpenAI Responses API para consultas con contexto de negocio e historial por usuario; Instagram API con Instagram Login para videos y reproducciones; eventos compatibles con External Request de Manychat para atribución. El consultor analiza información; no ejecuta comandos ni modifica registros. Se conserva la interfaz.

Credenciales en `integrations.json`, dentro del directorio privado de datos y fuera del repositorio. Configuración interactiva con entrada oculta para secretos. El servidor no devuelve secretos ni errores crudos del proveedor. Ninguna conexión usa credenciales del entorno de desarrollo.

## Entregables

- [x] Configuración privada y transporte HTTPS: `brain/integrations/config.py`, `transport.py`, comando `configure_integrations`. Destinos fijos, sin redirecciones, límites y errores sanitizados.
- [x] Consultor: modelos propios de conversación y adjuntos; Responses con streaming, contexto actualizado, historial por usuario, bloqueo de turnos concurrentes y tamaño limitado. Archivos de texto, PDF e imágenes con referencias opacas y caducidad.
- [x] Inbound: modelos de publicación, evento, contacto y estado de sincronización; comando `sync_inbound` y botón autenticado; paginación acotada, credenciales por cuenta, idempotencia de eventos, atribución y cierre desde pipeline.
- [x] Webhook autenticado mediante secreto por instalación; servidor WSGI separado que solo expone esa ruta. Manual de instalación y de configuración HTTPS del receptor.
- [x] Conectar estados y controles en las pantallas, documentar privacidad, costos y límites. Revisar código y cambios, luego publicar en el repositorio existente.

No se ejecutarán pruebas ni llamadas reales a proveedores sin pedido del usuario. Las revisiones en este trabajo serán de código, contratos de API y documentación oficial. Las credenciales reales y la activación externa corresponden a cada instalación.

## Revisión

Revisar aislamiento entre usuarios, adjuntos ajenos o caducados, respuestas que incluyan secretos, reintentos duplicados, caídas durante sincronización, cuentas mal configuradas, paginación y fechas inválidas. Conservar lo último sincronizado cuando un proveedor falla. No interpretar cero como dato disponible cuando falta una métrica.

## Revisión final

Revisión independiente de código terminada. Se corrigieron la pérdida de reproducciones ante errores HTTP, la cuota de adjuntos ante solicitudes concurrentes y las referencias repetidas en el historial. También se reconcilian llamadas recibidas antes del evento de calificación. Se revisó sintaxis Python/JavaScript y el diff. No se agregaron ni ejecutaron pruebas ni se activaron cuentas externas.
