import { PrismaClient, type Prisma } from "@prisma/client";
import type {
  CancelarReservaInput,
  ListarReservasQuery,
} from "../schemas/reservas.schema.js";
import type { TokenPayload } from "./auth.service.js";

const prisma = new PrismaClient();

export class ReservaNotFoundError extends Error {}
export class ReservaConflictError extends Error {}
export class ReservaForbiddenError extends Error {}
export class ReservaBusinessError extends Error {}
export class UsuarioNotFoundError extends Error {}

export async function listarReservas(
  filtros: ListarReservasQuery,
  usuarioAuth: TokenPayload,
) {
  const where: Prisma.ReservaWhereInput = {};

  if (usuarioAuth.rol === "ADMIN") {
    if (filtros.usuarioId) {
      where.usuarioId = filtros.usuarioId;
    }
  } else {
    where.usuarioId = usuarioAuth.id;
  }

  const ahora = new Date();

  if (filtros.estado === "activas") {
    where.fechaHoraCancelacion = null;
    where.fechaHoraFin = { gt: ahora };
  } else if (filtros.estado === "canceladas") {
    where.fechaHoraCancelacion = { not: null };
  } else if (filtros.estado === "finalizadas") {
    where.fechaHoraCancelacion = null;
    where.fechaHoraFin = { lte: ahora };
  }

  return prisma.reserva.findMany({
    where,
    orderBy: {
      fechaHoraInicio: "desc",
    },
    include: {
      recursos: {
        include: {
          recurso: true,
        },
      },
      usuario: {
        select: {
          id: true,
          nombre: true,
          apellido: true,
          email: true,
        },
      },
    },
  });
}

export async function resolverTitularReserva(
  usuarioIdPropuesto: number | undefined,
  usuarioAuth: TokenPayload,
): Promise<number> {
  if (
    usuarioIdPropuesto !== undefined &&
    usuarioIdPropuesto !== usuarioAuth.id
  ) {
    if (usuarioAuth.rol !== "ADMIN") {
      throw new ReservaForbiddenError(
        "Solo los administradores pueden crear reservas en nombre de otros usuarios",
      );
    }

    const usuarioExiste = await prisma.usuario.findUnique({
      where: { id: usuarioIdPropuesto },
      select: { id: true },
    });

    if (!usuarioExiste) {
      throw new ReservaNotFoundError("El usuario especificado no existe");
    }

    return usuarioIdPropuesto;
  }

  return usuarioAuth.id;
}

export async function cancelarReserva(
  id: number,
  input: CancelarReservaInput | undefined,
  usuarioAuth: TokenPayload,
) {
  const reserva = await prisma.reserva.findUnique({
    where: { id },
    include: {
      recursos: {
        include: {
          recurso: true,
        },
      },
    },
  });

  if (!reserva) {
    throw new ReservaNotFoundError("Reserva no encontrada");
  }

  if (input?.usuarioId) {
    if (usuarioAuth.rol !== "ADMIN" && input.usuarioId !== usuarioAuth.id) {
      throw new ReservaForbiddenError(
        "No tienes permisos para cancelar reservas de otro usuario",
      );
    }
    if (reserva.usuarioId !== input.usuarioId) {
      throw new ReservaNotFoundError(
        "Reserva no encontrada para el usuario especificado",
      );
    }
  }

  if (usuarioAuth.rol !== "ADMIN" && reserva.usuarioId !== usuarioAuth.id) {
    throw new ReservaForbiddenError(
      "No tienes permisos para cancelar esta reserva",
    );
  }

  if (reserva.fechaHoraCancelacion !== null) {
    throw new ReservaConflictError("La reserva ya se encuentra cancelada");
  }

  if (reserva.fechaHoraCheckIn !== null) {
    throw new ReservaBusinessError(
      "No se puede cancelar una reserva que ya realizó check-in",
    );
  }

  const ahora = new Date();
  if (reserva.fechaHoraFin <= ahora) {
    throw new ReservaBusinessError(
      "No se puede cancelar una reserva cuya fecha de fin ya ha transcurrido",
    );
  }

  return prisma.reserva.update({
    where: { id },
    data: {
      fechaHoraCancelacion: ahora,
      motivoCancelacion: input?.motivoCancelacion?.trim() || null,
    },
    include: {
      recursos: {
        include: {
          recurso: true,
        },
      },
    },
  });
}
