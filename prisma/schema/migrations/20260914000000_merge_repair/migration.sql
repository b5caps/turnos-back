-- Preserve existing authentication data while adopting the shared domain model.
CREATE TYPE "Rol" AS ENUM ('ADMIN', 'EXTERNO', 'UTN');
CREATE TYPE "TipoDocumento" AS ENUM ('DNI', 'CUIL');

DROP INDEX "Usuario_correo_key";
DROP INDEX "Usuario_legajo_key";
DROP INDEX "Usuario_dni_key";

ALTER TABLE "Usuario" RENAME COLUMN "correo" TO "email";
ALTER TABLE "Usuario" RENAME COLUMN "dni" TO "documento";
ALTER TABLE "Usuario" ADD COLUMN "tipoDocumento" "TipoDocumento" NOT NULL DEFAULT 'DNI';
ALTER TABLE "Usuario" ADD COLUMN "apellido" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Usuario" ADD COLUMN "telefono" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Usuario" ADD COLUMN "rol" "Rol" NOT NULL DEFAULT 'UTN';

CREATE TABLE "PerfilUTN" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "legajo" TEXT NOT NULL,
    "docente" BOOLEAN NOT NULL,
    "carrera" TEXT,
    "passwordHash" TEXT NOT NULL,
    "ultimaSincronizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilUTN_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PerfilUTN" (
    "usuarioId",
    "legajo",
    "docente",
    "passwordHash",
    "ultimaSincronizacion"
)
SELECT "id", "legajo", false, "password", "updatedAt"
FROM "Usuario";

ALTER TABLE "Usuario" DROP COLUMN "legajo";
ALTER TABLE "Usuario" DROP COLUMN "password";
ALTER TABLE "Usuario" DROP COLUMN "createdAt";
ALTER TABLE "Usuario" DROP COLUMN "updatedAt";
ALTER TABLE "Usuario" ALTER COLUMN "tipoDocumento" DROP DEFAULT;
ALTER TABLE "Usuario" ALTER COLUMN "apellido" DROP DEFAULT;
ALTER TABLE "Usuario" ALTER COLUMN "telefono" DROP DEFAULT;
ALTER TABLE "Usuario" ALTER COLUMN "rol" DROP DEFAULT;

CREATE TABLE "PerfilExterno" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "localidad" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "organizacion" TEXT NOT NULL,

    CONSTRAINT "PerfilExterno_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Recurso" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "capacidad" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,

    CONSTRAINT "Recurso_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sala" (
    "id" SERIAL NOT NULL,
    "recursoId" INTEGER NOT NULL,
    "ubicacion" TEXT NOT NULL,

    CONSTRAINT "Sala_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notebook" (
    "id" SERIAL NOT NULL,
    "recursoId" INTEGER NOT NULL,
    "numeroSerie" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,

    CONSTRAINT "Notebook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Disponibilidad" (
    "id" SERIAL NOT NULL,
    "recursoId" INTEGER NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "minutosInicio" INTEGER NOT NULL,
    "minutosFin" INTEGER NOT NULL,

    CONSTRAINT "Disponibilidad_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Bloqueo" (
    "id" SERIAL NOT NULL,
    "recursoId" INTEGER NOT NULL,
    "fechaHoraInicio" TIMESTAMP(3) NOT NULL,
    "fechaHoraFin" TIMESTAMP(3),
    "motivo" TEXT NOT NULL,

    CONSTRAINT "Bloqueo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Reserva" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "fechaHoraInicio" TIMESTAMP(3) NOT NULL,
    "fechaHoraFin" TIMESTAMP(3) NOT NULL,
    "fechaLimiteCheckIn" TIMESTAMP(3) NOT NULL,
    "fechaHoraConfirmacion" TIMESTAMP(3),
    "fechaHoraCancelacion" TIMESTAMP(3),
    "motivoCancelacion" TEXT,
    "fechaHoraCheckIn" TIMESTAMP(3),
    "fechaHoraCheckOut" TIMESTAMP(3),
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacion" TEXT,

    CONSTRAINT "Reserva_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReservaRecurso" (
    "reservaId" INTEGER NOT NULL,
    "recursoId" INTEGER NOT NULL,

    CONSTRAINT "ReservaRecurso_pkey" PRIMARY KEY ("reservaId", "recursoId")
);

CREATE TABLE "ReservaPendiente" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "fechaHoraDeseadaInicio" TIMESTAMP(3) NOT NULL,
    "fechaHoraDeseadaFin" TIMESTAMP(3) NOT NULL,
    "fechaHoraSolicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservaPendiente_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReservaPendienteRecurso" (
    "reservaPendienteId" INTEGER NOT NULL,
    "recursoId" INTEGER NOT NULL,

    CONSTRAINT "ReservaPendienteRecurso_pkey" PRIMARY KEY ("reservaPendienteId", "recursoId")
);

CREATE UNIQUE INDEX "Usuario_documento_key" ON "Usuario"("documento");
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");
CREATE UNIQUE INDEX "PerfilUTN_usuarioId_key" ON "PerfilUTN"("usuarioId");
CREATE UNIQUE INDEX "PerfilUTN_legajo_key" ON "PerfilUTN"("legajo");
CREATE UNIQUE INDEX "PerfilExterno_usuarioId_key" ON "PerfilExterno"("usuarioId");
CREATE UNIQUE INDEX "Sala_recursoId_key" ON "Sala"("recursoId");
CREATE UNIQUE INDEX "Notebook_recursoId_key" ON "Notebook"("recursoId");

ALTER TABLE "PerfilUTN" ADD CONSTRAINT "PerfilUTN_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PerfilExterno" ADD CONSTRAINT "PerfilExterno_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sala" ADD CONSTRAINT "Sala_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notebook" ADD CONSTRAINT "Notebook_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Disponibilidad" ADD CONSTRAINT "Disponibilidad_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bloqueo" ADD CONSTRAINT "Bloqueo_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservaRecurso" ADD CONSTRAINT "ReservaRecurso_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservaRecurso" ADD CONSTRAINT "ReservaRecurso_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservaPendiente" ADD CONSTRAINT "ReservaPendiente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservaPendienteRecurso" ADD CONSTRAINT "ReservaPendienteRecurso_reservaPendienteId_fkey" FOREIGN KEY ("reservaPendienteId") REFERENCES "ReservaPendiente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservaPendienteRecurso" ADD CONSTRAINT "ReservaPendienteRecurso_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
