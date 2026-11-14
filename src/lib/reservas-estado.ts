import type { OrigenCheckIn, TipoCancelacion } from "@prisma/client";
import { reloj } from "./reloj.js";

export function estadoReserva(reserva: {
  esPendiente?: boolean;
  tipoCancelacion?: TipoCancelacion | null;
  fechaHoraCancelacion?: Date | null;
  fechaHoraCheckOut?: Date | null;
  fechaHoraInicio: Date;
  fechaHoraFin: Date;
}) {
  if (reserva.esPendiente) return "PENDIENTE" as const;
  if (reserva.fechaHoraCancelacion)
    return reserva.tipoCancelacion === "AUSENCIA"
      ? ("LIBERADA_POR_AUSENCIA" as const)
      : ("CANCELADA" as const);
  const ahora = reloj.ahora();
  if (reserva.fechaHoraCheckOut || reserva.fechaHoraFin <= ahora)
    return "FINALIZADA" as const;
  return reserva.fechaHoraInicio <= ahora
    ? ("EN_CURSO" as const)
    : ("CONFIRMADA" as const);
}

export function datosAsistencia(reserva: {
  id: number;
  fechaHoraInicio: Date;
  fechaHoraFin: Date;
  fechaLimiteCheckIn: Date;
  fechaHoraCheckIn: Date | null;
  origenCheckIn: OrigenCheckIn | null;
  checkInRegistradoPorId: number | null;
  fechaHoraCancelacion: Date | null;
  tipoCancelacion: TipoCancelacion | null;
  fechaHoraCheckOut: Date | null;
}) {
  return {
    id: reserva.id,
    estado: estadoReserva(reserva),
    fechaLimiteCheckIn: reserva.fechaLimiteCheckIn.toISOString(),
    fechaHoraCheckIn: reserva.fechaHoraCheckIn?.toISOString() ?? null,
    origenCheckIn: reserva.origenCheckIn,
    checkInRegistradoPorId: reserva.checkInRegistradoPorId,
  };
}
