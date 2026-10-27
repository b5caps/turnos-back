import { PrismaClient } from "@prisma/client";
import { DURACION_HOLD_MINUTOS } from "./disponibilidad.service.js";

const prisma = new PrismaClient();

/**
 * Limpia y elimina reservas pendientes cuyo Hold de 10 minutos haya expirado sin confirmación.
 */
export async function limpiarHoldsExpirados(): Promise<number> {
  const limiteExpiracion = new Date(
    Date.now() - DURACION_HOLD_MINUTOS * 60 * 1000,
  );

  const expiradas = await prisma.reservaPendiente.findMany({
    where: {
      fechaHoraSolicitud: { lte: limiteExpiracion },
    },
    select: { id: true },
  });

  if (expiradas.length === 0) {
    return 0;
  }

  const ids = expiradas.map((e) => e.id);

  await prisma.reservaPendienteRecurso.deleteMany({
    where: { reservaPendienteId: { in: ids } },
  });

  const resultado = await prisma.reservaPendiente.deleteMany({
    where: { id: { in: ids } },
  });

  if (resultado.count > 0) {
    console.log(
      `[Limpieza] ${resultado.count} reserva(s) pendiente(s) expirada(s) eliminada(s).`,
    );
  }

  return resultado.count;
}
