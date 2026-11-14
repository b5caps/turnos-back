ALTER TABLE "Configuracion" ADD COLUMN "minutosGraciaCheckIn" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "Configuracion" ADD CONSTRAINT "Configuracion_gracia_valida"
CHECK ("minutosGraciaCheckIn" BETWEEN 1 AND 120);

CREATE TYPE "TipoCancelacion" AS ENUM ('USUARIO', 'ADMINISTRADOR', 'AUSENCIA');
CREATE TYPE "OrigenCheckIn" AS ENUM ('QR', 'ADMIN');

ALTER TABLE "Reserva"
ADD COLUMN "controlAsistencia" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "tipoCancelacion" "TipoCancelacion",
ADD COLUMN "origenCheckIn" "OrigenCheckIn",
ADD COLUMN "checkInRegistradoPorId" INTEGER;

-- No reclasificar como ausente el historial finalizado antes del despliegue.
UPDATE "Reserva" SET "controlAsistencia" = false
WHERE "fechaHoraFin" <= CURRENT_TIMESTAMP;

ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_checkInRegistradoPorId_fkey"
FOREIGN KEY ("checkInRegistradoPorId") REFERENCES "Usuario"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Reserva_fechaLimiteCheckIn_idx" ON "Reserva"("fechaLimiteCheckIn");

CREATE TABLE "QrEspacio" (
  "id" SERIAL NOT NULL,
  "recursoId" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fechaRevocacion" TIMESTAMP(3),
  CONSTRAINT "QrEspacio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QrEspacio_recursoId_fkey" FOREIGN KEY ("recursoId")
    REFERENCES "Recurso"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QrEspacio_tokenHash_key" ON "QrEspacio"("tokenHash");
CREATE INDEX "QrEspacio_recursoId_fechaRevocacion_idx" ON "QrEspacio"("recursoId", "fechaRevocacion");
-- Solo un QR vigente por espacio, también ante emisiones concurrentes.
CREATE UNIQUE INDEX "QrEspacio_un_vigente_por_recurso" ON "QrEspacio"("recursoId")
WHERE "fechaRevocacion" IS NULL;
