import { PrismaClient, Prisma } from "@prisma/client";
import type {
  CancelarReservaInput,
  FinalizarReservaInput,
  ListarReservasQuery,
} from "../schemas/reservas.schema.js";
import type { TokenPayload } from "./auth.service.js";
import {
  calcularFechaLimiteCheckIn,
  DURACION_HOLD_MINUTOS,
} from "./disponibilidad.service.js";

const prisma = new PrismaClient();

export class ReservaNotFoundError extends Error {}
export class ReservaConflictError extends Error {}
export class ReservaForbiddenError extends Error {}
export class ReservaBusinessError extends Error {}

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

  if (filtros.estado === "pendientes") {
    const limiteExpiracion = new Date(
      ahora.getTime() - DURACION_HOLD_MINUTOS * 60 * 1000,
    );
    const wherePendiente: Prisma.ReservaPendienteWhereInput = {
      fechaHoraSolicitud: { gt: limiteExpiracion },
    };

    if (usuarioAuth.rol === "ADMIN") {
      if (filtros.usuarioId) {
        wherePendiente.usuarioId = filtros.usuarioId;
      }
    } else {
      wherePendiente.usuarioId = usuarioAuth.id;
    }

    const pendientes = await prisma.reservaPendiente.findMany({
      where: wherePendiente,
      orderBy: {
        fechaHoraSolicitud: "desc",
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

    return pendientes.map((p) => ({
      id: p.id,
      usuarioId: p.usuarioId,
      usuario: p.usuario,
      fechaHoraInicio: p.fechaHoraDeseadaInicio,
      fechaHoraFin: p.fechaHoraDeseadaFin,
      fechaLimiteCheckIn: p.fechaHoraDeseadaInicio,
      fechaHoraConfirmacion: null,
      fechaHoraCancelacion: null,
      fechaHoraCheckIn: null,
      fechaHoraCheckOut: null,
      motivoCancelacion: null,
      observacion: null,
      fechaExpiracionHold: new Date(
        p.fechaHoraSolicitud.getTime() + DURACION_HOLD_MINUTOS * 60 * 1000,
      ),
      confirmada: false,
      esPendiente: true,
      recursos: p.recursos,
    }));
  }

  if (filtros.estado === "activas") {
    where.fechaHoraCancelacion = null;
    where.fechaHoraFin = { gt: ahora };
  } else if (filtros.estado === "canceladas") {
    where.fechaHoraCancelacion = { not: null };
  } else if (filtros.estado === "finalizadas") {
    where.fechaHoraCancelacion = null;
    where.fechaHoraFin = { lte: ahora };
  }

  const reservas = await prisma.reserva.findMany({
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

  return reservas.map((r) => ({
    ...r,
    fechaExpiracionHold: null as Date | null,
    confirmada: r.fechaHoraConfirmacion !== null,
    esPendiente: false,
  }));
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

export async function finalizarReserva(
  id: number,
  input: FinalizarReservaInput,
  usuarioAuth: TokenPayload,
) {
  const reserva = await prisma.reserva.findUnique({
    where: { id },
  });

  if (!reserva) {
    throw new ReservaNotFoundError("Reserva no encontrada");
  }

  if (usuarioAuth.rol !== "ADMIN" && reserva.usuarioId !== usuarioAuth.id) {
    throw new ReservaForbiddenError(
      "No tienes permisos para finalizar esta reserva",
    );
  }

  if (reserva.fechaHoraCancelacion !== null) {
    throw new ReservaConflictError("La reserva ya se encuentra cancelada");
  }

  if (reserva.fechaHoraCheckOut !== null) {
    throw new ReservaConflictError("La reserva ya se encuentra finalizada");
  }

  if (reserva.fechaHoraCheckIn === null) {
    throw new ReservaBusinessError(
      "No se puede finalizar una reserva que no ha realizado check-in",
    );
  }

  const ahora = new Date();
  if (ahora < reserva.fechaHoraInicio || ahora >= reserva.fechaHoraFin) {
    throw new ReservaBusinessError(
      "Solo se pueden finalizar reservas que se encuentren en curso en el horario actual",
    );
  }

  return prisma.reserva.update({
    where: { id },
    data: {
      fechaHoraCheckOut: ahora,
      fechaHoraFin: ahora,
      ...(input?.observacion?.trim()
        ? { observacion: input.observacion.trim() }
        : {}),
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

export async function confirmarReserva(
  reservaPendienteId: number,
  usuarioAuth: TokenPayload,
) {
  return prisma.$transaction(async (tx) => {
    const pendiente = await tx.reservaPendiente.findUnique({
      where: { id: reservaPendienteId },
      include: {
        recursos: {
          include: {
            recurso: true,
          },
        },
      },
    });

    if (!pendiente) {
      throw new ReservaNotFoundError("Reserva pendiente no encontrada");
    }

    if (usuarioAuth.rol !== "ADMIN" && pendiente.usuarioId !== usuarioAuth.id) {
      throw new ReservaForbiddenError(
        "No tienes permisos para confirmar esta reserva pendiente",
      );
    }

    const ahora = new Date();
    const expiracion = new Date(
      pendiente.fechaHoraSolicitud.getTime() + DURACION_HOLD_MINUTOS * 60 * 1000,
    );
    if (ahora > expiracion) {
      await tx.reservaPendienteRecurso.deleteMany({
        where: { reservaPendienteId: pendiente.id },
      });
      await tx.reservaPendiente.delete({
        where: { id: pendiente.id },
      });
      throw new ReservaConflictError(
        "El tiempo de 10 minutos para confirmar la reserva ha expirado. El cupo ha sido liberado.",
      );
    }

    const fechaLimiteCheckIn = calcularFechaLimiteCheckIn(
      pendiente.fechaHoraDeseadaInicio,
      pendiente.fechaHoraDeseadaFin,
    );

    const recursoIds = pendiente.recursos
      .map((r) => r.recursoId)
      .sort((a, b) => a - b);
    if (recursoIds.length > 0) {
      await tx.$queryRaw`
        SELECT id FROM "Recurso"
        WHERE id IN (${Prisma.join(recursoIds)})
        FOR UPDATE
      `;
    }

    const reservaConfirmada = await tx.reserva.create({
      data: {
        usuarioId: pendiente.usuarioId,
        fechaHoraInicio: pendiente.fechaHoraDeseadaInicio,
        fechaHoraFin: pendiente.fechaHoraDeseadaFin,
        fechaLimiteCheckIn,
        fechaHoraConfirmacion: ahora,
        recursos: {
          create: pendiente.recursos.map((r) => ({ recursoId: r.recursoId })),
        },
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

    await tx.reservaPendienteRecurso.deleteMany({
      where: { reservaPendienteId: pendiente.id },
    });
    await tx.reservaPendiente.delete({
      where: { id: pendiente.id },
    });

    return reservaConfirmada;
  });
}
