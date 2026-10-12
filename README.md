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

- `POST /api/auth/registro`: registro propio exclusivo para usuarios `EXTERNO`.
  Campos: `tipoDocumento` (`DNI` o `CUIL`), `documento`, `nombre`, `apellido`,
  `email`, `telefono`, `password` (mínimo 8 caracteres, máximo 72 bytes),
  `localidad`, `provincia` y `organizacion`.
  (Los usuarios pertenecientes a UTN no se registran públicamente; provienen del padrón institucional).
- `POST /api/auth/login`: `{ "email": "usuario@ejemplo.com", "password": "contraseña" }` o `{ "username": "legajo", "password": "contraseña" }`.
- `POST /api/auth/logout`: Cerrar sesión e invalidar el token activo en el servidor.
  - **Autenticación**: Requiere header `Authorization: Bearer <token>`.
  - Retorna `200` con `{ message: "Sesión cerrada exitosamente" }`. El token revocado es rechazado en solicitudes posteriores con `401`.

Ambas rutas de registro y login devuelven `{ usuario: { id, rol, nombre, apellido, email }, token, expiresIn }`.
El JWT incluye el ID en `sub` y el rol. El registro público solo crea usuarios externos y no permite crear administradores.
Las cuentas anteriores sin contraseña no pueden iniciar sesión hasta que se les asigne una.

En una base nueva, aplicar las migraciones con `pnpm exec prisma migrate deploy --schema prisma`.
La base Railway configurada actualmente tiene otro historial y otra estructura de tablas:
hay que conciliar esa base con el esquema del repositorio antes de aplicar migraciones allí.

## Reservas

- `POST /api/reservas`: Crear una reserva para recursos/espacios (RF-11).
  - **Autenticación**: Requiere header `Authorization: Bearer <token>`.
  - **Titular de la reserva**:
    - **Usuarios comunes (`UTN`, `EXTERNO`)**: Solo pueden reservar a su propio nombre (se toma del token JWT). Si intentan especificar un `usuarioId` ajeno, retorna `403`.
    - **Administrador (`ADMIN`)**: Puede reservar a su propio nombre (ej. reserva institucional / bloqueo de periodo determinado) o en nombre de otro usuario especificando `usuarioId` en el cuerpo.
  - **Cuerpo**: `{ "usuarioId": 12, "recursoIds": [1, 2], "fechaHoraInicio": "2026-09-05T14:00:00Z", "fechaHoraFin": "2026-09-05T15:00:00Z", "fechaLimiteCheckIn": "...", "observacion": "..." }` (`usuarioId` es opcional).
  - **Reglas de negocio**:
    - Retorna `201` con los datos de la reserva creada.
    - Retorna `400` si el rango horario es inválido o los recursos no están disponibles.
    - Retorna `401` si no está autenticado o el token es inválido.
    - Retorna `403` si un usuario no administrador intenta reservar a nombre de otro.
    - Retorna `404` si el `usuarioId` destino indicado por un administrador no existe.

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
