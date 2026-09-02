-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMIN', 'EXTERNO', 'UTN');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('DNI', 'CUIL');

-- CreateTable
CREATE TABLE "Recurso" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "capacidad" INTEGER NOT NULL,

    CONSTRAINT "Recurso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sala" (
    "id" SERIAL NOT NULL,
    "recursoId" INTEGER NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,

    CONSTRAINT "Sala_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notebook" (
    "id" SERIAL NOT NULL,
    "recursoId" INTEGER NOT NULL,
    "numeroSerie" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,

    CONSTRAINT "Notebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disponibilidad" (
    "id" SERIAL NOT NULL,
    "recursoId" INTEGER NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "minutosInicio" INTEGER NOT NULL,
    "minutosFin" INTEGER NOT NULL,

    CONSTRAINT "Disponibilidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bloqueo" (
    "id" SERIAL NOT NULL,
    "recursoId" INTEGER NOT NULL,
    "fechaHoraInicio" TIMESTAMP(3) NOT NULL,
    "fechaHoraFin" TIMESTAMP(3),
    "motivo" TEXT NOT NULL,

    CONSTRAINT "Bloqueo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservaRecurso" (
    "reservaId" INTEGER NOT NULL,
    "recursoId" INTEGER NOT NULL,

    CONSTRAINT "ReservaRecurso_pkey" PRIMARY KEY ("reservaId","recursoId")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "ReservaPendiente" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "fechaHoraDeseadaInicio" TIMESTAMP(3) NOT NULL,
    "fechaHoraDeseadaFin" TIMESTAMP(3) NOT NULL,
    "fechaHoraSolicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservaPendiente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "tipoDocumento" "TipoDocumento" NOT NULL,
    "documento" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfilUTN" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "legajo" TEXT NOT NULL,
    "docente" BOOLEAN NOT NULL,
    "carrera" TEXT,
    "ultimaSincronizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilUTN_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfilExterno" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "localidad" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "organizacion" TEXT NOT NULL,

    CONSTRAINT "PerfilExterno_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sala_recursoId_key" ON "Sala"("recursoId");

-- CreateIndex
CREATE UNIQUE INDEX "Notebook_recursoId_key" ON "Notebook"("recursoId");

-- CreateIndex
CREATE UNIQUE INDEX "PerfilUTN_usuarioId_key" ON "PerfilUTN"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "PerfilExterno_usuarioId_key" ON "PerfilExterno"("usuarioId");

-- AddForeignKey
ALTER TABLE "Sala" ADD CONSTRAINT "Sala_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notebook" ADD CONSTRAINT "Notebook_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disponibilidad" ADD CONSTRAINT "Disponibilidad_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bloqueo" ADD CONSTRAINT "Bloqueo_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaRecurso" ADD CONSTRAINT "ReservaRecurso_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaRecurso" ADD CONSTRAINT "ReservaRecurso_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "Recurso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaPendiente" ADD CONSTRAINT "ReservaPendiente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerfilUTN" ADD CONSTRAINT "PerfilUTN_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerfilExterno" ADD CONSTRAINT "PerfilExterno_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
