import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { reloj } from "../lib/reloj.js";
import { bloquearReserva } from "../lib/reservas-lock.js";

function sinAsistenciaVencida(ahora: Date): Prisma.ReservaWhereInput {
  return {
    controlAsistencia: true,
    fechaHoraConfirmacion: { not: null },
    fechaHoraCancelacion: null,
    fechaHoraCheckIn: null,
    fechaHoraCheckOut: null,
    fechaHoraInicio: { lte: ahora },
    fechaLimiteCheckIn: { lte: ahora },
  };
}

function datosAusencia(ahora: Date) {
  return {
    fechaHoraCancelacion: ahora,
    tipoCancelacion: "AUSENCIA" as const,
    motivoCancelacion: "Liberada automáticamente por ausencia",
  };
}

/** Se llama después de bloquear los recursos de la nueva solicitud. */
export async function liberarAusenciasDeRecursos(
  tx: Prisma.TransactionClient,
  recursoIds: number[],
) {
  const candidatas = await tx.reserva.findMany({
    where: {
      ...sinAsistenciaVencida(reloj.ahora()),
      recursos: { some: { recursoId: { in: recursoIds } } },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let total = 0;
  for (const { id } of candidatas) {
    await tx.$queryRaw`SELECT id FROM "Reserva" WHERE id = ${id} FOR UPDATE`;
    const ahora = reloj.ahora();
    const resultado = await tx.reserva.updateMany({
      where: { id, ...sinAsistenciaVencida(ahora) },
      data: datosAusencia(ahora),
    });
    total += resultado.count;
  }
  return total;
}

/** Lotes acotados; seguro ante ejecuciones simultáneas y reinicios. */
export async function liberarReservasAusentes(): Promise<number> {
  const candidatas = await prisma.reserva.findMany({
    where: sinAsistenciaVencida(reloj.ahora()),
    select: { id: true },
    orderBy: [{ fechaLimiteCheckIn: "asc" }, { id: "asc" }],
    take: 100,
  });
  let total = 0;
  for (const { id } of candidatas) {
    total += await prisma.$transaction(async (tx) => {
      if (!(await bloquearReserva(tx, id))) return 0;
      const ahora = reloj.ahora();
      const resultado = await tx.reserva.updateMany({
        where: { id, ...sinAsistenciaVencida(ahora) },
        data: datosAusencia(ahora),
      });
      return resultado.count;
    });
  }
  return total;
}

export function iniciarLiberacionPorAusencia(intervaloMs = 30000) {
  let ejecutando = false;
  const ejecutar = async () => {
    if (ejecutando) return;
    ejecutando = true;
    try {
      await liberarReservasAusentes();
    } catch (error) {
      console.error("[Ausencias] Error al liberar reservas:", error);
    } finally {
      ejecutando = false;
    }
  };
  const timer = setInterval(() => {
    void ejecutar();
  }, intervaloMs);
  void ejecutar();
  return () => clearInterval(timer);
}
