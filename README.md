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

## Reservas

- `GET /api/reservas`: Listar reservas para el usuario autenticado.
  - **Autenticación**: Requiere header `Authorization: Bearer <token>`.
  - **Query params opcionales**:
    - `estado`: `activas`, `pendientes`, `canceladas`, `finalizadas` o `todas`.
    - `usuarioId`: ID del usuario a consultar (solo permitido para usuarios con rol `ADMIN`).
  - **Reglas de negocio**:
    - Usuarios comunes (`UTN` / `EXTERNO`): Reciben únicamente sus propias reservas.
    - Administradores (`ADMIN`): Reciben todas las reservas o las del `usuarioId` indicado.
  - **Retorno**: `200` con array `{ data: [ ...reservas ] }`. Cada reserva expone `fechaExpiracionHold`, `fechaHoraConfirmacion` y `confirmada`.

- `POST /api/reservas`: Crear una reserva para recursos/espacios (RF-11) con Hold temporal de 10 minutos.
  - **Autenticación**: Requiere header `Authorization: Bearer <token>`.
  - **Titular de la reserva**:
    - **Usuarios comunes (`UTN`, `EXTERNO`)**: Solo pueden reservar a su propio nombre. Inician en estado de reserva temporal ("Hold" de 10 minutos) que debe confirmarse posteriormente.
    - **Administrador (`ADMIN`)**: Puede reservar a su propio nombre o de terceros, y opcionalmente puede enviar `"confirmarInmediato": true` para omitir el hold y confirmarla directamente.
  - **Cuerpo**: `{ "usuarioId": 12, "recursoIds": [1, 2], "fechaHoraInicio": "2026-09-05T14:00:00Z", "fechaHoraFin": "2026-09-05T15:00:00Z", "fechaLimiteCheckIn": "...", "observacion": "...", "confirmarInmediato": false }`.
  - **Reglas de negocio**:
    - Retorna `201` con la reserva en estado Hold (o confirmada).
    - Retorna `409` si el recurso ya fue apartado o reservado por otro usuario concurrente (protegido por `SELECT ... FOR UPDATE`).
    - Retorna `400` si el rango horario es inválido.
    - Retorna `401` si no está autenticado o el token es inválido.
    - Retorna `403` si un usuario no administrador intenta reservar a nombre de otro o usar `confirmarInmediato`.
    - Retorna `404` si el `usuarioId` destino indicado por un administrador no existe.

- `POST /api/reservas/:id/confirmar`: Confirmar una reserva en estado Hold.
  - **Autenticación**: Requiere header `Authorization: Bearer <token>`.
  - **Autorización**: El usuario autenticado debe ser el titular de la reserva o Administrador.
  - **Reglas de negocio**:
    - Retorna `200` con la reserva confirmada y consolida el turno definitivamente.
    - Retorna `404` si la reserva no existe.
    - Retorna `403` si el usuario no es el titular ni administrador.
    - Retorna `409` si la reserva ya está confirmada, ya fue cancelada, o su tiempo de Hold (10 min) expiró.

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
