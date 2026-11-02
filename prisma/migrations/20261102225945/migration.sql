-- AlterTable
ALTER TABLE "Recurso" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Configuracion" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "minutosApertura" INTEGER NOT NULL DEFAULT 480,
    "minutosCierre" INTEGER NOT NULL DEFAULT 1320,
    "tiempoMaximoAntelacionDias" INTEGER NOT NULL DEFAULT 30,
    "duracionMinimaMinutos" INTEGER NOT NULL DEFAULT 30,
    "duracionMaximaMinutos" INTEGER NOT NULL DEFAULT 240,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Configuracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservaPendienteRecurso" (
    "reservaPendienteId" INTEGER NOT NULL,
    "recursoId" INTEGER NOT NULL,

    CONSTRAINT "ReservaPendienteRecurso_pkey" PRIMARY KEY ("reservaPendienteId","recursoId")
);

-- AddForeignKey
ALTER TABLE "ReservaPendienteRecurso" ADD CONSTRAINT "ReservaPendienteRecurso_reservaPendienteId_fkey" FOREIGN KEY ("reservaPendienteId") REFERENCES "ReservaPendiente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaPendienteRecurso" ADD CONSTRAINT "ReservaPendienteRecurso_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
