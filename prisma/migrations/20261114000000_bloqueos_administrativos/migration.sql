-- La autoría queda nula para bloqueos anteriores a esta funcionalidad.
ALTER TABLE "Bloqueo"
ADD COLUMN "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "creadoPorId" INTEGER;

ALTER TABLE "Bloqueo" ADD CONSTRAINT "Bloqueo_rango_valido"
CHECK ("fechaHoraFin" IS NULL OR "fechaHoraFin" > "fechaHoraInicio");

CREATE INDEX "Bloqueo_recursoId_fechaHoraInicio_idx"
ON "Bloqueo"("recursoId", "fechaHoraInicio");

ALTER TABLE "Bloqueo" ADD CONSTRAINT "Bloqueo_creadoPorId_fkey"
FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
