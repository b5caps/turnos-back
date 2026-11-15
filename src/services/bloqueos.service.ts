import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { bloquearRecursos, bloqueosSolapados } from "../lib/bloqueos.js";
import { instanteDelEstablecimiento, sumarDiasFecha } from "../lib/horarios.js";
import type {
  CrearBloqueoInput,
  ListarBloqueosQuery,
} from "../schemas/bloqueos.schema.js";
import type { TokenPayload } from "./auth.service.js";

export class BloqueoNotFoundError extends Error {}
export class BloqueoForbiddenError extends Error {}

function exigirAdministrador(usuario: TokenPayload) {
  if (usuario.rol !== "ADMIN") {
    throw new BloqueoForbiddenError("Se requieren permisos de administrador");
  }
}

async function exigirEspacio(
  db: Pick<Prisma.TransactionClient, "recurso">,
  id: number,
) {
  const espacio = await db.recurso.findFirst({
    where: { id, sala: { isNot: null } },
    select: { id: true },
  });
  if (!espacio) throw new BloqueoNotFoundError("Espacio no encontrado");
}

export async function crearBloqueo(
  id: number,
  input: CrearBloqueoInput,
  usuario: TokenPayload,
) {
  exigirAdministrador(usuario);
  const inicio =
    input.tipo === "FRANJA"
      ? new Date(input.fechaHoraInicio)
      : instanteDelEstablecimiento(input.fechaDesde);
  const fin =
    input.tipo === "FRANJA"
      ? input.fechaHoraFin
        ? new Date(input.fechaHoraFin)
        : null
      : instanteDelEstablecimiento(sumarDiasFecha(input.fechaHasta, 1));

  return prisma.$transaction(async (tx) => {
    await bloquearRecursos(tx, [id]);
    await exigirEspacio(tx, id);
    // No se modifican reservas ni holds anteriores. El bloqueo afecta nuevas
    // solicitudes y las confirmaciones posteriores mientras esté vigente.
    return tx.bloqueo.create({
      data: {
        recursoId: id,
        fechaHoraInicio: inicio,
        fechaHoraFin: fin,
        motivo: input.motivo,
        creadoPorId: usuario.id,
      },
    });
  });
}

export async function listarBloqueos(
  id: number,
  query: ListarBloqueosQuery,
  usuario: TokenPayload,
) {
  exigirAdministrador(usuario);
  await exigirEspacio(prisma, id);
  const where: Prisma.BloqueoWhereInput = { recursoId: id };
  if (query.desde)
    Object.assign(
      where,
      bloqueosSolapados(
        new Date(query.desde),
        query.hasta ? new Date(query.hasta) : null,
      ),
    );
  else if (query.hasta) where.fechaHoraInicio = { lt: new Date(query.hasta) };
  return prisma.bloqueo.findMany({
    where,
    orderBy: [{ fechaHoraInicio: "asc" }, { id: "asc" }],
  });
}

export async function eliminarBloqueo(
  id: number,
  bloqueoId: number,
  usuario: TokenPayload,
) {
  exigirAdministrador(usuario);
  await prisma.$transaction(async (tx) => {
    await bloquearRecursos(tx, [id]);
    await exigirEspacio(tx, id);
    const resultado = await tx.bloqueo.deleteMany({
      where: { id: bloqueoId, recursoId: id },
    });
    if (resultado.count === 0)
      throw new BloqueoNotFoundError("Bloqueo no encontrado en este espacio");
  });
}
