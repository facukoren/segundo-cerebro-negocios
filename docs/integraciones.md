# Conectar Consultor e Inbound

Las integraciones usan cuentas y credenciales de tu instalación. El proyecto no trae ninguna clave.

Ejecutá los comandos con el entorno virtual activado y con el mismo `SECOND_BRAIN_DATA_DIR` que usa el servidor. Primero actualizá la base y los estáticos:

```sh
python scripts/bootstrap.py
```

## Dónde quedan las claves

`python manage.py configure_integrations` guarda `integrations.json` dentro del directorio privado de datos, fuera del repositorio. En Linux/macOS lo crea con permisos `0600`. Las entradas secretas no se muestran al escribirlas ni se imprimen al terminar. La app vuelve a leer el archivo en cada operación.

Incluí ese archivo en tus copias privadas. No lo adjuntes a issues, capturas ni conversaciones. El navegador recibe indicadores de conexión; nunca recibe las claves.

## Consultor: OpenAI

Necesitás una cuenta de la API de OpenAI con saldo y acceso a los modelos que elijas. La suscripción de ChatGPT no configura esta app. El consumo se factura en tu cuenta de OpenAI; configurá allí tus límites de gasto.

```sh
python manage.py configure_integrations openai
```

El comando pide:

1. La API key.
2. El ID del modelo principal.
3. El ID del modelo rápido. Podés repetir el anterior.

Usá IDs habilitados en tu cuenta que acepten **Responses API**. Para imágenes y PDF, ambos modelos también deben aceptar esos tipos de entrada. La app no presupone modelos ni reemplaza silenciosamente uno por otro. Consultá el [catálogo oficial](https://developers.openai.com/api/docs/models).

Abrí **Consultor**, elegí Principal o Rápido y enviá una pregunta. Las respuestas llegan por streaming. **Nueva conversación** empieza un historial distinto. **Detener** corta la conexión; el proveedor puede haber consumido tokens antes del corte.

### Qué recibe OpenAI

Al enviar una consulta se transmiten:

- El mensaje y hasta 20 mensajes recientes de esa conversación, con un límite de texto adicional.
- Las métricas actuales y los registros del negocio: clientes, leads, finanzas, cajas, tareas, tickets y notas. Si el detalle supera el límite, se indica cuántos registros se omitieron.
- Hasta cuatro adjuntos entre los actuales y los más recientes del historial. Los anteriores pueden quedar fuera del contexto; volvé a adjuntarlos si son necesarios.

El historial se guarda localmente por usuario. Los turnos incompletos no se agregan al historial del servidor. Se usa `store: false` en OpenAI; esto no reemplaza las políticas de tratamiento y retención del proveedor. Las claves y el archivo de configuración no forman parte del contexto.

El consultor sirve para analizar y recomendar. No ejecuta comandos, abre archivos del servidor, modifica registros ni envía mensajes a terceros.

### Adjuntos y retención

Se admiten `.txt`, `.md`, `.csv` y `.json` en UTF-8; PDF; PNG, JPEG y WebP. Máximo 2 MB por archivo, cuatro por consulta y 20 MB almacenados por usuario durante 24 horas. El texto tiene un límite adicional de 100.000 caracteres. Un usuario no puede adjuntar archivos de otro.

Los adjuntos se guardan en la base privada con identificadores aleatorios. Dejan de estar disponibles a las 24 horas. Se borran al volver a usar el chat, subir otro archivo o ejecutar:

```sh
python manage.py cleanup_consultor
```

Ese comando también borra conversaciones inactivas durante 30 días. Programalo una vez al día si necesitás que la limpieza ocurra sin actividad en la app. Las copias de seguridad pueden conservar versiones anteriores.

## Inbound: Instagram

La conexión usa **Instagram API con Instagram Login** para cuentas profesionales. Necesitás tu propia app de Meta, un Instagram user ID y un token con acceso a esa cuenta. Los permisos de lectura e insights deben estar habilitados; el acceso a cuentas ajenas a los roles de tu app puede requerir revisión de Meta.

Seguí la [configuración oficial de Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/) y su [guía de insights](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/insights/). Usá la versión de Graph API habilitada en tu app.

```sh
python manage.py configure_integrations instagram
```

El comando pide la versión de API, un identificador local (por ejemplo `marca`), el usuario, el Instagram user ID, el token y las keywords. También pide objetivos para cada etapa por 30 días. Volvé a ejecutarlo para agregar otra cuenta o reemplazar una existente usando el mismo identificador. Se admiten hasta diez cuentas.

Usá una keyword distinta por video: por ejemplo `GUIA01`, `GUIA02`. Incluí esa palabra en el caption. Las keywords se cargan en mayúsculas; la comparación no distingue mayúsculas y minúsculas. Si un caption contiene varias keywords configuradas, el video queda sin atribución automática.

### Sincronizar

Usá **Sincronizar** dentro de Inbound o ejecutá:

```sh
python manage.py sync_inbound
```

Podés programar ese comando cada seis horas con cron o el programador de tareas de tu sistema. No hay un proceso de sincronización oculto dentro del servidor web.

Cada ejecución consulta hasta 50 publicaciones recientes por cuenta, conserva videos de los últimos 90 días y actualiza sus reproducciones. La ejecución tiene un límite total de tiempo; una cuenta con error conserva sus datos anteriores. Hay una espera de un minuto entre intentos por cuenta. Si se alcanza el límite de publicaciones, el tablero indica que el historial puede estar incompleto.

Las reproducciones son acumuladas por video, no reproducciones ocurridas dentro del período seleccionado. Si Instagram no devuelve la métrica, la fila muestra `—` y se avisa que el total es parcial. El token debe renovarse según su vencimiento en Meta; esta app no lo renueva automáticamente.

## DMs, leads y llamadas: Manychat o tu automatización

Instagram aporta los videos y sus métricas. Los DMs con keyword, los leads calificados y las llamadas agendadas entran por un webhook. Manychat puede enviar esos eventos con [External Request](https://help.manychat.com/hc/en-us/articles/14281285374364-Dev-Tools-External-request); su disponibilidad depende de tu plan.

Creá un secreto aleatorio de al menos 32 caracteres en tu gestor de contraseñas. Pegá el mismo secreto en el configurador y en el encabezado de Manychat:

```sh
python manage.py configure_integrations webhook
```

### Publicar solo el receptor

Manychat necesita una URL HTTPS accesible desde internet. El tablero sigue escuchando en localhost. Arrancá **otro proceso** para el receptor:

```sh
waitress-serve --listen=127.0.0.1:8001 --max-request-body-size=65536 core.webhook_wsgi:application
```

Este proceso responde únicamente a `/api/inbound/eventos`; las demás rutas devuelven 404. Publicalo detrás de un proxy con HTTPS. Ejemplo para Caddy, reemplazando el dominio por uno propio:

```caddyfile
eventos.example.com {
    @inbound path /api/inbound/eventos
    handle @inbound {
        reverse_proxy 127.0.0.1:8001
    }
    handle {
        respond 404
    }
}
```

No abras el puerto del tablero. No agregues encabezados Authorization ni cuerpos de solicitudes a los logs del proxy. El webhook no usa cookies ni la sesión del dashboard: autentica cada evento con el secreto compartido.

### Configurar External Request

- Método: `POST`.
- URL: `https://eventos.example.com/api/inbound/eventos`.
- Encabezados: `Content-Type: application/json` y `Authorization: Bearer TU_SECRETO`.
- Cuerpo JSON, usando variables del contacto y la automatización:

```json
{
  "event_id": "evento-estable-001",
  "event_type": "dm_keyword",
  "account_id": "marca",
  "contact_id": "contacto-001",
  "keyword": "GUIA01",
  "occurred_at": "2026-10-29T15:00:00Z"
}
```

Los valores del ejemplo son ficticios. `occurred_at` lleva la fecha real del evento, con zona horaria. `account_id` coincide con el identificador local configurado. `contact_id` debe mantenerse estable entre los eventos de una misma persona.

Enviá un evento en cada paso de tu automatización:

| `event_type` | Momento | Efecto |
|---|---|---|
| `dm_keyword` | La persona responde con la keyword | Registra el primer contacto |
| `lead_calificado` | Cumple tus criterios de calificación | Crea un lead inbound; requiere también `contact_name` |
| `llamada_agendada` | Confirma una llamada | Registra la llamada y mueve un lead en conversación a call agendada |

El cierre se registra al mover ese lead a **Cerrado** en el pipeline. No se crea un cliente facturable automáticamente.

`event_id` identifica un evento, no un contacto. Mantenelo idéntico en todos los reintentos de ese evento y usá uno distinto para la etapa siguiente. Es opcional: si falta, se deduplica por cuenta, contacto, tipo, keyword y fecha. No reemplaces la fecha por la hora del reintento.

Un evento nuevo devuelve `201`; uno repetido, `200` y `duplicado: true`. Un `401` indica que el secreto no coincide. Un `400` indica campos inválidos, keyword desconocida o cuenta sin configurar. Un `503` permite reintentar con el mismo cuerpo.

### Leer la atribución

Se atribuye cada contacto a su primer DM, siempre que corresponda a un único video publicado antes de ese DM. Reutilizar una keyword en varios videos puede dejar eventos sin atribución. Los eventos repetidos no multiplican leads, llamadas ni cierres.

Los totales muestran contactos que alcanzaron cada etapa dentro del período. Las tasas de conversión usan la cohorte cuyo primer DM ocurrió en ese período y respetan el orden DM → lead → llamada → cierre. Por eso las tasas no siempre equivalen a dividir los totales visibles. El ranking puede incluir videos anteriores que generaron conversiones durante el período.

## Desactivar o cambiar credenciales

```sh
python manage.py configure_integrations openai --disable
python manage.py configure_integrations instagram --disable
python manage.py configure_integrations webhook --disable
```

Estos comandos eliminan la conexión del archivo local y conservan los datos ya registrados. Para cambiar una clave o token, ejecutá otra vez su configurador. Si una credencial se expuso, revocala también en el proveedor.

## Límites de esta entrega

Se implementaron los contratos de las APIs y las protecciones locales mediante revisión de código. No se realizaron pruebas ni llamadas con credenciales reales durante el desarrollo. Cada instalación debe comprobar sus permisos, modelos y automatizaciones con sus propias cuentas antes de depender de los resultados.
