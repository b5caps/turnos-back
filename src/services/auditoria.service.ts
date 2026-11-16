import type { AccionAuditoria, Prisma, Rol } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type { AccionAuditoria };

export type PrismaDbClient = Prisma.TransactionClient | typeof prisma;

export interface ActorAuditoria {
  id: number;
  nombre: string;
  apellido: string;
  email: string;
}

export interface EventoBitacora {
  accion: AccionAuditoria;
  actorId: number | null;
  actorRol: Rol;
  actor: ActorAuditoria | null;
  fechaHora: string;
  detalle: string | null;
}

export interface ResumenAuditoriaReserva {
  creadoPorId: number | null;
  canceladoPorId: number | null;
  canceladoPorRol: Rol | null;
  bitacora: EventoBitacora[];
}

export interface RegistrarEventoReservaParams {
  reservaId: number;
  accion: AccionAuditoria;
  actorId: number | null;
  actorRol: Rol;
  fechaHora?: Date;
  detalle?: string | null;
}

/**
 * Registra un evento de auditoría sobre una reserva dentro del cliente o transacción Prisma recibido.
 */
export async function registrarEventoReserva(
  db: PrismaDbClient,
  params: RegistrarEventoReservaParams,
): Promise<void> {
  await db.reservaBitacora.create({
    data: {
      reservaId: params.reservaId,
      accion: params.accion,
      actorId: params.actorId,
      actorRol: params.actorRol,
      fechaHora: params.fechaHora ?? new Date(),
      detalle: params.detalle ?? null,
    },
  });
}

/**
 * Construye el resumen de autoría (creación, cancelación y bitácora ordenada) de una reserva.
 */
export function construirResumenAuditoria(
  eventos: EventoBitacora[],
  fallback?: {
    titularId?: number;
    creadoPorId?: number | null;
    canceladoPorId?: number | null;
  },
): ResumenAuditoriaReserva {
  const creacion =
    eventos.find((e) => e.accion === "CREACION") ??
    eventos.find((e) => e.accion === "CONFIRMACION");
  const cancelaciones = eventos.filter((e) => e.accion === "CANCELACION");
  const cancelacion =
    cancelaciones.length > 0 ? cancelaciones[cancelaciones.length - 1] : null;

  return {
    creadoPorId:
      fallback?.creadoPorId ?? creacion?.actorId ?? fallback?.titularId ?? null,
    canceladoPorId: fallback?.canceladoPorId ?? cancelacion?.actorId ?? null,
    canceladoPorRol: cancelacion?.actorRol ?? null,
    bitacora: eventos,
  };
}

/**
 * Obtiene la bitácora completa de un conjunto de reservas desde PostgreSQL vía Prisma.
 */
export async function obtenerAuditoriasReservas(
  reservaIds: number[],
  db: PrismaDbClient = prisma,
): Promise<Map<number, EventoBitacora[]>> {
  const resultado = new Map<number, EventoBitacora[]>();
  if (reservaIds.length === 0) return resultado;

  const filas = await db.reservaBitacora.findMany({
    where: { reservaId: { in: reservaIds } },
    include: {
      actor: {
        select: {
          id: true,
          nombre: true,
          apellido: true,
          email: true,
        },
      },
    },
    orderBy: [{ fechaHora: "asc" }, { id: "asc" }],
  });

  for (const fila of filas) {
    const lista = resultado.get(fila.reservaId) ?? [];
    lista.push({
      accion: fila.accion,
      actorId: fila.actorId,
      actorRol: fila.actorRol,
      actor: fila.actor
        ? {
            id: fila.actor.id,
            nombre: fila.actor.nombre,
            apellido: fila.actor.apellido,
            email: fila.actor.email,
          }
        : null,
      fechaHora: fila.fechaHora.toISOString(),
      detalle: fila.detalle ?? null,
    });
    resultado.set(fila.reservaId, lista);
  }

  return resultado;
}

/**
 * Obtiene el resumen de auditoría de una única reserva.
 */
export async function obtenerAuditoriaReserva(
  reservaId: number,
  fallback?: {
    titularId?: number;
    creadoPorId?: number | null;
    canceladoPorId?: number | null;
  },
  db: PrismaDbClient = prisma,
): Promise<ResumenAuditoriaReserva> {
  const map = await obtenerAuditoriasReservas([reservaId], db);
  const eventos = map.get(reservaId) ?? [];
  return construirResumenAuditoria(eventos, fallback);
}
