import type { Prisma } from "@prisma/client";
import { bloquearRecursos } from "./bloqueos.js";

/** Mismo orden para check-in, ausencia y cambios manuales: recursos, luego reserva. */
export async function bloquearReserva(
  tx: Prisma.TransactionClient,
  id: number,
  recursosAdicionales: number[] = [],
) {
  const referencia = await tx.reserva.findUnique({
    where: { id },
    select: { recursos: { select: { recursoId: true } } },
  });
  if (!referencia) return false;
  await bloquearRecursos(tx, [
    ...referencia.recursos.map((r) => r.recursoId),
    ...recursosAdicionales,
  ]);
  await tx.$queryRaw`SELECT id FROM "Reserva" WHERE id = ${id} FOR UPDATE`;
  return true;
}
