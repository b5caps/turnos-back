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
- `POST /api/auth/login`: `{ "email": "usuario@ejemplo.com", "password": "contraseña" }`.

Ambas rutas devuelven `{ usuario: { id, rol, nombre, apellido, email }, token, expiresIn }`.
El JWT incluye el ID en `sub` y el rol. El registro público no crea administradores.
Las cuentas anteriores sin contraseña no pueden iniciar sesión hasta que se les asigne una.

En una base nueva, aplicar las migraciones con `pnpm exec prisma migrate deploy --schema prisma`.
La base Railway configurada actualmente tiene otro historial y otra estructura de tablas:
hay que conciliar esa base con el esquema del repositorio antes de aplicar migraciones allí.
