CREATE TYPE "AccionAuditoria" AS ENUM (
  'CREACION',
  'CONFIRMACION',
  'EDICION',
  'CANCELACION',
  'FINALIZACION'
);

ALTER TABLE "Reserva"
ADD COLUMN "creadoPorId" INTEGER,
ADD COLUMN "canceladoPorId" INTEGER;

ALTER TABLE "Reserva"
ADD CONSTRAINT "Reserva_creadoPorId_fkey"
FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Reserva"
ADD CONSTRAINT "Reserva_canceladoPorId_fkey"
FOREIGN KEY ("canceladoPorId") REFERENCES "Usuario"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReservaBitacora" (
  "id" SERIAL NOT NULL,
  "reservaId" INTEGER NOT NULL,
  "accion" "AccionAuditoria" NOT NULL,
  "actorId" INTEGER,
  "actorRol" "Rol" NOT NULL,
  "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detalle" TEXT,
  CONSTRAINT "ReservaBitacora_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReservaBitacora_reservaId_fkey"
    FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReservaBitacora_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "Usuario"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ReservaBitacora_reservaId_fechaHora_id_idx"
ON "ReservaBitacora"("reservaId", "fechaHora", "id");
