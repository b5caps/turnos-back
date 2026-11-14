Recuerde definir las variables correspondientes en el archivo .env:

```
DATABASE_URL=postgresql://santi:santi@localhost/santi?host=/run/postgresql
JWT_SECRET=string-aleatoria-abc123
```

Correr los siguientes comandos:

```
pnpm install
pnpm dev
```

Abrir [http://localhost:3000/docs](http://localhost:3000/docs) para ver la documentación de la API.

## Autenticación

Configurar `DATABASE_URL` y `JWT_SECRET` en `.env`. Opcionalmente,
`JWT_EXPIRES_IN_SECONDS` define la duración del token (por defecto, 86400 segundos).
Las rutas están documentadas en `http://localhost:3000/docs`.

- `POST /api/auth/registro`: registro propio de usuarios `UTN` o `EXTERNO`.
  Campos comunes: `rol`, `tipoDocumento` (`DNI` o `CUIL`), `documento`,
  `nombre`, `apellido`, `email`, `telefono` y `password` (mínimo 8 caracteres,
  máximo 72 bytes).
  UTN agrega `legajo`, `docente` (booleano) y opcionalmente `carrera`.
  EXTERNO agrega `localidad`, `provincia` y `organizacion`.
- `POST /api/auth/login`: `{ "username": "email o legajo", "password": "contraseña" }`.
- `POST /api/auth/logout`: Cerrar sesión e invalidar el token activo en el servidor.
  - **Autenticación**: Requiere header `Authorization: Bearer <token>`.
  - Retorna `200` con `{ message: "Sesión cerrada exitosamente" }`. El token revocado es rechazado en solicitudes posteriores con `401`.

Ambas rutas de registro y login devuelven `{ usuario: { id, rol, nombre, apellido, email }, token, expiresIn }`.
El JWT incluye el ID en `sub` y el rol. El registro público no crea administradores.
Las cuentas anteriores sin contraseña no pueden iniciar sesión hasta que se les asigne una.

En una base nueva, aplicar las migraciones con `pnpm exec prisma migrate deploy --schema prisma`.
La base Railway configurada actualmente tiene otro historial y otra estructura de tablas:
hay que conciliar esa base con el esquema del repositorio antes de aplicar migraciones allí.

## Reservas y Control de Concurrencia (Hold Temporal de 10 min)

- `GET /api/reservas`: Listar reservas para el usuario autenticado.
  - **Autenticación**: Requiere header `Authorization: Bearer <token>`.
  - **Query params opcionales**:
    - `estado`: `activas`, `canceladas`, `finalizadas`, `pendientes` o `todas`.
    - `usuarioId`: ID del usuario a consultar (solo permitido para usuarios con rol `ADMIN`).
  - **Reglas de negocio**:
    - Usuarios comunes (`UTN` / `EXTERNO`): Reciben únicamente sus propias reservas o holds pendientes.
    - Administradores (`ADMIN`): Reciben todas las reservas o las del `usuarioId` indicado.
  - **Retorno**: `200` con array `{ data: [ ...reservas ] }`.

- `POST /api/reservas`: Iniciar una reserva de recursos/espacios con control de concurrencia pesimista (`FOR UPDATE`).
  - **Autenticación**: Requiere header `Authorization: Bearer <token>`.
  - **Flujo de Reserva Pendiente (Hold de 10 minutos)**:
    - Para usuarios comunes (`UTN`, `EXTERNO`), la solicitud aparta temporalmente el cupo en el modelo `ReservaPendiente` por **10 minutos**, bloqueando de forma segura e inmediata la disponibilidad para otros usuarios concurrentes.
    - Los administradores (`ADMIN`) pueden especificar `"confirmarInmediato": true` para crear la reserva confirmada de forma directa sin pasar por el estado de hold.
  - **Titular de la reserva**:
    - **Usuarios comunes (`UTN`, `EXTERNO`)**: Solo pueden reservar a su propio nombre (se toma del token JWT). Si intentan especificar un `usuarioId` ajeno, retorna `403`.
    - **Administrador (`ADMIN`)**: Puede reservar a su propio nombre (ej. reserva institucional / bloqueo de periodo determinado) o en nombre de otro usuario especificando `usuarioId` en el cuerpo.
  - **Cuerpo**: `{ "usuarioId": 12, "recursoIds": [1, 2], "fechaHoraInicio": "2026-09-05T14:00:00Z", "fechaHoraFin": "2026-09-05T15:00:00Z", "confirmarInmediato": false, "observacion": "..." }` (`usuarioId` es opcional; al confirmar, el backend calcula la fecha límite de check-in según `minutosGraciaCheckIn`). El cliente no puede elegir ni extender ese límite.
  - **Retorno**: `201` con los datos de la `ReservaPendiente` (incluye `fechaExpiracionHold` y `esPendiente: true`) o de la `Reserva` confirmada.

- `POST /api/reservas/:id/confirmar`: Confirmar definitivamente una reserva pendiente (Hold).
  - **Autenticación**: Requiere header `Authorization: Bearer <token>`.
  - **Parámetro de ruta**: `id` de la `ReservaPendiente`.

  - **Reglas de negocio**:
    - Debe ejecutarse dentro de los 10 minutos desde la creación del Hold.
    - Al confirmar, convierte atómicamente la `ReservaPendiente` en una `Reserva` confirmada definitiva y elimina la reserva pendiente.
    - Si pasaron más de 10 minutos, retorna `409 Conflict`, elimina el Hold y libera el cupo.
    - Un proceso en segundo plano ejecuta automáticamente la limpieza de holds expirados cada 60 segundos (`limpiarHoldsExpirados`).

## Cancelación de Reservas

- `PATCH /api/reservas/:id/cancelar`: Cancelar una reserva existente.
  - **Autenticación**: Requiere header `Authorization: Bearer <token>`.
  - **Autorización**: El usuario autenticado debe ser el titular de la reserva (`usuarioId`) o poseer rol `ADMIN`.
  - **Cuerpo opcional**: `{ "motivoCancelacion": "Motivo opcional" }`.
  - **Reglas de negocio**:
    - Retorna `404` si la reserva no existe.
    - Retorna `403` si no es el dueño ni administrador.
    - Retorna `409` si la reserva ya se encuentra cancelada.
    - Retorna `400` si la reserva ya finalizó o ya se le realizó check-in.
  - Retorna `200` con la reserva cancelada y libera inmediatamente la disponibilidad de los recursos.

## Bloqueos administrativos de espacios

Solo `ADMIN` puede crear, listar o eliminar bloqueos. El ID del espacio es
`Recurso.id` (el mismo que devuelve `/api/espacios`); no es `Sala.id`.
Los endpoints rechazan IDs de notebooks. Requieren `Authorization: Bearer <token>`.

### Crear

`POST /api/espacios/{id}/bloqueos`

Franja temporal (los timestamps deben incluir `Z` o un offset):

```json
{
  "tipo": "FRANJA",
  "fechaHoraInicio": "2026-12-08T10:00:00-03:00",
  "fechaHoraFin": "2026-12-08T14:00:00-03:00",
  "motivo": "Mantenimiento"
}
```

Para un bloqueo indefinido, enviar explícitamente `"fechaHoraFin": null`.
No hay recurrencias semanales: el bloqueo indefinido es continuo desde el inicio.

Días completos (ambas fechas son inclusivas):

```json
{
  "tipo": "DIAS_COMPLETOS",
  "fechaDesde": "2026-12-24",
  "fechaHasta": "2026-12-25",
  "motivo": "Feriado"
}
```

El backend convierte las fechas a `[24/12 00:00, 26/12 00:00)` en
`America/Argentina/Buenos_Aires`, independientemente de la zona del servidor.
La respuesta `201` contiene `{ data: { id, recursoId, fechaHoraInicio,
fechaHoraFin, motivo, fechaCreacion, creadoPorId } }`, con timestamps en UTC.
El motivo es obligatorio y admite hasta 255 caracteres. Los registros anteriores
a esta funcionalidad pueden tener `creadoPorId: null`.

### Listar y eliminar

- `GET /api/espacios/{id}/bloqueos`: devuelve `{ data: [...] }`, ordenado por
  inicio e ID. Sin filtros incluye el historial.
- Filtros opcionales `desde` y `hasta`: timestamps con zona horaria; devuelven
  los bloqueos que se superponen con `[desde, hasta)`, incluidos los indefinidos.
  Se pueden enviar por separado. Codificar `+` como `%2B` al usar offsets en la URL.
- `DELETE /api/espacios/{id}/bloqueos/{bloqueoId}`: devuelve `204` sin cuerpo.
  Un bloqueo inexistente o perteneciente a otro espacio devuelve `404`.
- Errores de datos: `400`; sin autenticación: `401`; sin rol ADMIN: `403`.

### Efecto sobre reservas y disponibilidad

- Los intervalos son semiabiertos: una reserva puede terminar exactamente al
  inicio del bloqueo o comenzar exactamente a su fin.
- Los bloqueos afectan todo el espacio, aun si quedan cupos libres.
- Crear un bloqueo no modifica ni cancela reservas confirmadas anteriores.
  La cancelación continúa siendo una operación específica e independiente.
- Las nuevas solicitudes, incluidas las reservas inmediatas de ADMIN, reciben
  `409` si se superponen con un bloqueo.
- Un hold anterior tampoco puede confirmarse durante el bloqueo (`409`). Se
  conserva hasta su vencimiento y puede confirmarse si se elimina el bloqueo
  mientras sigue vigente.
- Se permiten bloqueos superpuestos. Eliminar uno retira inmediatamente esa
  restricción; los demás bloqueos, la capacidad, el estado activo y los horarios
  siguen aplicándose. No requiere reiniciar el servidor ni esperar la limpieza.
- Crear/eliminar bloqueos y crear/confirmar reservas se coordinan mediante
  locks de recursos en PostgreSQL, adquiridos en orden de ID.

Las consultas públicas actuales siguen siendo:

```text
GET /api/recursos/disponibilidad/salas?fecha=2026-12-08
GET /api/recursos/disponibilidad/notebooks?fecha=2026-12-08
```

Devuelven `{ horarioEstablecimiento, recursos }`. Cada recurso tiene `bloques`
de 15 minutos; un bloqueo produce `disponible: false` y, dentro del horario,
`motivoNoDisponible: "bloqueado"`. El calendario debe usar esos datos y consultar
nuevamente después de crear/eliminar bloqueos. No hay notificaciones push.
La visualización y la selección administrativa corresponden a T04/T05; el
contrato está disponible también en `/doc` y `/docs`.

### Migración y pruebas

La migración `20261114000000_bloqueos_administrativos` reutiliza `Bloqueo`, agrega
autoría y fecha de creación, un índice por recurso/inicio y una restricción que
impide fines anteriores o iguales al inicio. Aplicar sobre una base compatible
con las migraciones del repositorio:

```sh
pnpm exec prisma generate --schema prisma
pnpm exec prisma migrate deploy --schema prisma
pnpm build
pnpm test
```

Las pruebas de integración requieren PostgreSQL real, una base de pruebas
dedicada ya migrada y `TEST_DATABASE_URL`. No utilizan la URL de `.env` para
acceder a la base y eliminan sus propios fixtures al finalizar.
`src/app.ts` exporta la aplicación sin abrir puertos ni iniciar el temporizador.

Ejemplo reproducible en PowerShell con una base descartable:

```powershell
docker run --detach --rm --name turnos-bloqueos-tests -e POSTGRES_USER=turnos_test -e POSTGRES_PASSWORD=turnos_test -e POSTGRES_DB=turnos_test -p 127.0.0.1:55432:5432 postgres:16-alpine
$env:DATABASE_URL = 'postgresql://turnos_test:turnos_test@127.0.0.1:55432/turnos_test'
pnpm exec prisma migrate deploy --schema prisma
$env:TEST_DATABASE_URL = $env:DATABASE_URL
$env:TZ = 'Pacific/Auckland'
pnpm test:integration
pnpm exec tsc -p tsconfig.tests.json
docker stop turnos-bloqueos-tests
```

Se prueban permisos, validaciones, límites, bloqueos indefinidos y días completos,
disponibilidad inmediata, superposición de bloqueos, conservación de reservas y
holds previos. Las pruebas concurrentes ponen solicitudes HTTP en espera de un
lock real y verifican ambos órdenes entre bloqueo y reserva/confirmación, además
de impedir que dos confirmaciones simultáneas dupliquen la reserva.

## Check-in mediante QR y liberación por ausencia

### Tiempo de gracia

`GET /api/configuracion` y `PATCH /api/configuracion` (ADMIN) exponen
`minutosGraciaCheckIn`, entero entre 1 y 120, con valor inicial 15.

```json
{ "minutosGraciaCheckIn": 15 }
```

Al confirmar un hold o crear una reserva inmediata se guarda
`fechaLimiteCheckIn = min(inicio + gracia, fin)`. Cambiar la configuración no
recalcula las reservas ya confirmadas. Enviar `fechaLimiteCheckIn` en el cuerpo
de creación no modifica el límite calculado por el servidor. Un hold no equivale
a asistencia y no puede convertirse en reserva si su plazo de asistencia venció.

### Emitir e imprimir el QR del espacio

Configurar `CHECK_IN_URL` con la URL de la página que atenderá el escaneo, por
ejemplo `https://biblioteca.example/asistencia`. En desarrollo el valor por
defecto es `http://localhost:5000/asistencia`.

```text
POST   /api/espacios/{id}/qr     ADMIN: emitir o reemplazar
DELETE /api/espacios/{id}/qr     ADMIN: revocar
```

POST devuelve `201` con `{ data: { id, recursoId, fechaCreacion, tokenQr, url,
qrSvg } }`. `qrSvg` contiene la imagen SVG imprimible. La URL codificada usa un
fragmento `#tokenQr=...` para no enviar el token al servidor web al abrirla.
El consumidor debe leer ese fragmento y enviarlo en el cuerpo de la API.

El token aleatorio y el SVG se entregan únicamente al emitirlos. Guardar el SVG
para imprimirlo: el servidor almacena solo el hash SHA-256 del token. Cada
emisión revoca el QR anterior y existe como máximo uno vigente por espacio.
DELETE devuelve `204`; si no existe un QR vigente, `404`. Las notebooks no
admiten QR de espacio. Todos los endpoints requieren sesión autenticada.

El QR es estático y compartido por las reservas de ese espacio: identifica el
lugar, mientras la sesión y el horario determinan qué reserva puede registrar
asistencia. No constituye por sí solo una prueba de proximidad física.

### Consultar y registrar la llegada

Tras escanear y autenticar al usuario:

```http
POST /api/reservas/check-in/consultar
Authorization: Bearer <sesion>
Content-Type: application/json

{ "tokenQr": "<token-del-qr>" }
```

Devuelve `{ data: { recursoId, reservas: [...] } }` con reservas propias
confirmadas en curso, dentro del plazo de llegada o con asistencia ya registrada.
No registra asistencia ni expone reservas de otros usuarios.

```http
POST /api/reservas/{id}/check-in
Authorization: Bearer <sesion>
Content-Type: application/json

{ "tokenQr": "<token-del-qr>" }
```

El QR debe estar vigente y corresponder a un espacio de la reserva. Se registra
la llegada de la reserva completa, incluidos sus recursos asociados. Requiere
titular autenticado y reserva confirmada, no cancelada ni finalizada, con hora
del servidor en `[fechaHoraInicio, fechaLimiteCheckIn)`. En el límite exacto ya
corresponde ausencia. No se aceptan fechas provistas por el cliente.

Respuesta `200`: `{ data: { id, estado, fechaLimiteCheckIn, fechaHoraCheckIn,
origenCheckIn, checkInRegistradoPorId } }`. Los reintentos preservan fecha y
autoría originales, incluso si pasó el plazo tras el primer check-in válido.

El administrador también puede registrar la llegada del titular, sin QR:

```text
POST /api/reservas/{id}/check-in/manual
```

Aplica el mismo plazo y registra origen `ADMIN` y la identidad del administrador.
El flujo QR registra origen `QR` y la identidad del titular. Los IDs corresponden
a reservas definitivas, no a holds.

Errores: `400` datos inválidos; `401` sin sesión; `403` sin permisos; `404` reserva
o QR inexistente/revocado; `409` horario no habilitado, reserva no confirmada,
cancelada/finalizada/liberada o QR de otro espacio. El check-in administrativo
no permite sobrescribir asistencias ni reactivar reservas liberadas.

### Liberación automática

Al iniciar el servidor se ejecuta el proceso de ausencias y luego cada 30
segundos, en lotes de hasta 100 reservas. Busca reservas confirmadas cuyo límite
se alcanzó, sin asistencia, cancelación ni checkout. Guarda:

```text
tipoCancelacion = AUSENCIA
fechaHoraCancelacion = hora del servidor
motivoCancelacion = Liberada automáticamente por ausencia
```

La reserva y sus relaciones se conservan como historial. No se modifica el
horario original. Desde el commit deja de consumir cupo tanto en la sala como
en la notebook asociada. Otros bloqueos, reservas y horarios siguen aplicándose.
Además, crear una nueva reserva regulariza las ausencias vencidas que ocupen sus
recursos dentro de la misma transacción: no necesita esperar al siguiente ciclo.

Cada operación coordina locks de recursos (en orden de ID) y de reserva. El
check-in relee las condiciones y la hora después de esperar el lock. Los ciclos
simultáneos, incluso de distintos procesos, no duplican la liberación. Un error
se registra en el servidor y el siguiente ciclo vuelve a intentarlo.

Las respuestas de reservas incorporan `estado`, `tipoCancelacion`,
`origenCheckIn` y `checkInRegistradoPorId`. Los estados expuestos son
`PENDIENTE`, `CONFIRMADA`, `EN_CURSO`, `FINALIZADA`, `CANCELADA` y
`LIBERADA_POR_AUSENCIA`. Una reserva cancelada sin clasificación anterior
mantiene `tipoCancelacion: null`; las nuevas cancelaciones manuales distinguen
`USUARIO` y `ADMINISTRADOR`.

```text
GET /api/reservas?estado=liberadas_por_ausencia
```

El filtro `canceladas` también incluye ausencias. La migración
`20261115000000_check_in_ausencias` preserva sin reclasificar el historial ya
finalizado antes de aplicarla (`controlAsistencia=false`); las reservas nuevas y
las que todavía no finalizaron quedan sujetas al control automático. Los límites
ya existentes se conservan.

### Verificación

Los comandos de migración, compilación y pruebas anteriores siguen aplicándose.
La integración incluye QR/SVG, permisos, revocación, consulta de reservas propias,
check-in manual y QR, plazo exacto, idempotencia, gracia configurable, liberación
de sala y notebook, estado/filtro, ejecución periódica y tiempo simulado. Las
pruebas usan un reloj controlable y PostgreSQL real para comprobar operaciones
concurrentes. Los archivos de integración se ejecutan secuencialmente para
aislar la configuración compartida; sus casos de concurrencia siguen enviando
operaciones simultáneas.
