ALTER TABLE "Bloqueo"
ALTER COLUMN "recursoId" DROP NOT NULL;

CREATE INDEX "Bloqueo_fechaHoraInicio_fechaHoraFin_idx"
ON "Bloqueo"("fechaHoraInicio", "fechaHoraFin");

CREATE TABLE "Feriado" (
  "id" SERIAL NOT NULL,
  "fecha" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "creadoPorId" INTEGER,
  "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Feriado_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Feriado_creadoPorId_fkey"
    FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Feriado_fecha_key" ON "Feriado"("fecha");
CREATE INDEX "Feriado_fecha_idx" ON "Feriado"("fecha");
