import { Prisma } from "@prisma/client";

/** Intervalos semiabiertos [inicio, fin); null representa un fin indefinido. */
export function bloqueosSolapados(
  inicio: Date,
  fin?: Date | null,
): Prisma.BloqueoWhereInput {
  return {
    ...(fin ? { fechaHoraInicio: { lt: fin } } : {}),
    OR: [{ fechaHoraFin: null }, { fechaHoraFin: { gt: inicio } }],
  };
}

export async function bloquearRecursos(
  tx: Prisma.TransactionClient,
  ids: number[],
) {
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM "Recurso"
    WHERE id IN (${Prisma.join([...new Set(ids)])})
    ORDER BY id FOR UPDATE
  `;
}
