import { PrismaClient } from "@prisma/client";
import type { CancelarReservaInput } from "../schemas/reservas.schema.js";
import type { TokenPayload } from "./auth.service.js";

const prisma = new PrismaClient();

export class ReservaNotFoundError extends Error {}
export class ReservaConflictError extends Error {}
export class ReservaForbiddenError extends Error {}
export class ReservaBusinessError extends Error {}

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
