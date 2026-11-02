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
  - **Cuerpo**: `{ "usuarioId": 12, "recursoIds": [1, 2], "fechaHoraInicio": "2026-09-05T14:00:00Z", "fechaHoraFin": "2026-09-05T15:00:00Z", "confirmarInmediato": false, "observacion": "..." }` (`usuarioId` y `fechaLimiteCheckIn` son opcionales; el backend calcula automáticamente la fecha límite de check-in con 15 minutos de tolerancia posterior al inicio).
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
