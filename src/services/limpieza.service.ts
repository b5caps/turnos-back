import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Limpia y cancela formalmente reservas pendientes cuyo Hold de 10 minutos haya expirado.
 */
export async function limpiarHoldsExpirados(): Promise<number> {
  const ahora = new Date();

  const resultado = await prisma.reserva.updateMany({
    where: {
      fechaHoraConfirmacion: null,
      fechaHoraCancelacion: null,
      fechaExpiracionHold: { lte: ahora },
    },
    data: {
      fechaHoraCancelacion: ahora,
      motivoCancelacion: "Tiempo de confirmación expirado",
    },
  });

  if (resultado.count > 0) {
    console.log(
      `[Limpieza] ${resultado.count} reserva(s) con hold expirado marcada(s) como canceladas.`,
    );
  }

  return resultado.count;
}
