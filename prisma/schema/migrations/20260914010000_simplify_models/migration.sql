-- Consolidate user profiles and replace the generic resource hierarchy with rooms and notebooks.
CREATE TYPE "EstadoReserva" AS ENUM ('CONFIRMADA', 'EN_CURSO', 'FINALIZADA', 'CANCELADA', 'VENCIDA');
CREATE TYPE "TipoNotificacion" AS ENUM ('RESERVA_CREADA', 'RESERVA_CANCELADA', 'RECORDATORIO_CHECK_IN', 'ESPACIO_LIBERADO');

ALTER TABLE "Usuario" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "Usuario" ADD COLUMN "legajo" TEXT;
ALTER TABLE "Usuario" ADD COLUMN "carrera" TEXT;
ALTER TABLE "Usuario" ADD COLUMN "esDocente" BOOLEAN;
ALTER TABLE "Usuario" ADD COLUMN "organizacion" TEXT;
ALTER TABLE "Usuario" ADD COLUMN "localidad" TEXT;
ALTER TABLE "Usuario" ADD COLUMN "provincia" TEXT;
ALTER TABLE "Usuario" ADD COLUMN "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Usuario" ADD COLUMN "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Usuario" AS u
SET "passwordHash" = COALESCE(utn."passwordHash", externo."passwordHash"),
    "legajo" = utn."legajo",
    "carrera" = utn."carrera",
    "esDocente" = utn."docente",
    "organizacion" = externo."organizacion",
    "localidad" = externo."localidad",
    "provincia" = externo."provincia"
FROM "PerfilUTN" AS utn
FULL OUTER JOIN "PerfilExterno" AS externo ON externo."usuarioId" = utn."usuarioId"
WHERE u."id" = COALESCE(utn."usuarioId", externo."usuarioId");

ALTER TABLE "Usuario" ALTER COLUMN "passwordHash" SET NOT NULL;
CREATE UNIQUE INDEX "Usuario_legajo_key" ON "Usuario"("legajo");
DROP TABLE "PerfilUTN";
DROP TABLE "PerfilExterno";
ALTER TABLE "Usuario" DROP COLUMN "tipoDocumento";

ALTER TABLE "Sala" ADD COLUMN "nombre" TEXT;
ALTER TABLE "Sala" ADD COLUMN "descripcion" TEXT;
ALTER TABLE "Sala" ADD COLUMN "capacidad" INTEGER;
ALTER TABLE "Sala" ADD COLUMN "activa" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Sala" ADD COLUMN "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Sala" ADD COLUMN "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Sala" AS s
SET "nombre" = r."nombre", "descripcion" = r."descripcion", "capacidad" = r."capacidad"
FROM "Recurso" AS r
WHERE s."recursoId" = r."id";
ALTER TABLE "Sala" ALTER COLUMN "nombre" SET NOT NULL;
ALTER TABLE "Sala" ALTER COLUMN "capacidad" SET NOT NULL;

ALTER TABLE "Notebook" ADD COLUMN "codigo" TEXT;
ALTER TABLE "Notebook" ADD COLUMN "activa" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Notebook" ADD COLUMN "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Notebook" ADD COLUMN "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Notebook" SET "codigo" = "numeroSerie";
ALTER TABLE "Notebook" ALTER COLUMN "codigo" SET NOT NULL;
CREATE UNIQUE INDEX "Notebook_codigo_key" ON "Notebook"("codigo");

ALTER TABLE "Reserva" ADD COLUMN "salaId" INTEGER;
ALTER TABLE "Reserva" ADD COLUMN "notebookId" INTEGER;
ALTER TABLE "Reserva" ADD COLUMN "creadaPorId" INTEGER;
ALTER TABLE "Reserva" ADD COLUMN "cantidadPersonas" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Reserva" ADD COLUMN "estado" "EstadoReserva" NOT NULL DEFAULT 'CONFIRMADA';
ALTER TABLE "Reserva" ADD COLUMN "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Reserva" AS reserva
SET "salaId" = sala."id"
FROM "ReservaRecurso" AS reservaRecurso
JOIN "Sala" AS sala ON sala."recursoId" = reservaRecurso."recursoId"
WHERE reserva."id" = reservaRecurso."reservaId";
UPDATE "Reserva" AS reserva
SET "notebookId" = notebook."id"
FROM "ReservaRecurso" AS reservaRecurso
JOIN "Notebook" AS notebook ON notebook."recursoId" = reservaRecurso."recursoId"
WHERE reserva."id" = reservaRecurso."reservaId";
UPDATE "Reserva" SET "creadaPorId" = "usuarioId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Reserva" WHERE "salaId" IS NULL) THEN
    RAISE EXCEPTION 'No se puede migrar una reserva sin sala asociada';
  END IF;
END $$;

ALTER TABLE "Reserva" ALTER COLUMN "salaId" SET NOT NULL;
ALTER TABLE "Reserva" RENAME COLUMN "fechaCreacion" TO "creadoEn";
ALTER TABLE "Reserva" DROP COLUMN "fechaHoraConfirmacion";
DROP TABLE "ReservaRecurso";
DROP TABLE "ReservaPendienteRecurso";
DROP TABLE "ReservaPendiente";
DROP TABLE "Disponibilidad";
DROP TABLE "Bloqueo";

ALTER TABLE "Sala" DROP CONSTRAINT "Sala_recursoId_fkey";
ALTER TABLE "Notebook" DROP CONSTRAINT "Notebook_recursoId_fkey";
DROP INDEX "Sala_recursoId_key";
DROP INDEX "Notebook_recursoId_key";
ALTER TABLE "Sala" DROP COLUMN "recursoId";
ALTER TABLE "Notebook" DROP COLUMN "recursoId";
ALTER TABLE "Notebook" DROP COLUMN "numeroSerie";
DROP TABLE "Recurso";

ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_salaId_fkey" FOREIGN KEY ("salaId") REFERENCES "Sala"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Notificacion" (
  "id" SERIAL NOT NULL,
  "usuarioId" INTEGER NOT NULL,
  "reservaId" INTEGER,
  "tipo" "TipoNotificacion" NOT NULL,
  "mensaje" TEXT NOT NULL,
  "leidaEn" TIMESTAMP(3),
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notificacion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id") ON DELETE SET NULL ON UPDATE CASCADE;
