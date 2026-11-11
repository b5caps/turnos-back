import type { Rol } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type AccionAuditoria =
  | "CREACION"
  | "CONFIRMACION"
  | "EDICION"
  | "CANCELACION"
  | "FINALIZACION";

export interface EventoBitacora {
  accion: AccionAuditoria;
  actorId: number;
  actorRol: Rol;
  fechaHora: string;
  detalle: string | null;
}

export interface ResumenAuditoriaReserva {
  creadoPorId: number | null;
  canceladoPorId: number | null;
  canceladoPorRol: Rol | null;
  bitacora: EventoBitacora[];
}

// Respaldo en memoria para tests offline/mocked o cuando la tabla auxiliar no exista aún
const bitacoraMemoria = new Map<number, EventoBitacora[]>();
let tablaAsegurada = false;

async function asegurarTablaBitacora(): Promise<boolean> {
  if (tablaAsegurada) return true;
  if (typeof prisma.$executeRawUnsafe !== "function") return false;

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ReservaBitacora" (
        "id" SERIAL PRIMARY KEY,
        "reservaId" INTEGER NOT NULL,
        "accion" TEXT NOT NULL,
        "actorId" INTEGER NOT NULL,
        "actorRol" TEXT NOT NULL,
        "fechaHora" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "detalle" TEXT
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ReservaBitacora_reservaId_idx"
      ON "ReservaBitacora" ("reservaId")
    `);
    tablaAsegurada = true;
    return true;
  } catch {
    return false;
  }
}

export async function registrarEventoReserva(params: {
  reservaId: number;
  accion: AccionAuditoria;
  actorId: number;
  actorRol: Rol;
  fechaHora?: Date;
  detalle?: string | null;
}): Promise<void> {
  const fecha = params.fechaHora ?? new Date();
  const evento: EventoBitacora = {
    accion: params.accion,
    actorId: params.actorId,
    actorRol: params.actorRol,
    fechaHora: fecha.toISOString(),
    detalle: params.detalle ?? null,
  };

  const lista = bitacoraMemoria.get(params.reservaId) ?? [];
  lista.push(evento);
  bitacoraMemoria.set(params.reservaId, lista);

  const ok = await asegurarTablaBitacora();
  if (ok && typeof prisma.$executeRawUnsafe === "function") {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ReservaBitacora" ("reservaId", "accion", "actorId", "actorRol", "fechaHora", "detalle")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        params.reservaId,
        params.accion,
        params.actorId,
        params.actorRol,
        fecha,
        params.detalle ?? null,
      );
    } catch {
      // Mantiene registro en memoria si falla la persistencia auxiliar
    }
  }
}

export function construirResumenAuditoria(
  eventos: EventoBitacora[],
  titularId?: number,
): ResumenAuditoriaReserva {
  const creacion =
    eventos.find((e) => e.accion === "CREACION") ??
    eventos.find((e) => e.accion === "CONFIRMACION");
  const cancelaciones = eventos.filter((e) => e.accion === "CANCELACION");
  const cancelacion =
    cancelaciones.length > 0 ? cancelaciones[cancelaciones.length - 1] : null;

  return {
    creadoPorId: creacion?.actorId ?? titularId ?? null,
    canceladoPorId: cancelacion?.actorId ?? null,
    canceladoPorRol: cancelacion?.actorRol ?? null,
    bitacora: eventos,
  };
}

export async function obtenerAuditoriaReserva(
  reservaId: number,
  titularId?: number,
): Promise<ResumenAuditoriaReserva> {
  const map = await obtenerAuditoriasReservas([reservaId]);
  const eventos = map.get(reservaId) ?? [];
  return construirResumenAuditoria(eventos, titularId);
}

export async function obtenerAuditoriasReservas(
  reservaIds: number[],
): Promise<Map<number, EventoBitacora[]>> {
  const resultado = new Map<number, EventoBitacora[]>();
  if (reservaIds.length === 0) return resultado;

  const ok = await asegurarTablaBitacora();
  if (ok && typeof prisma.$queryRawUnsafe === "function") {
    try {
      const filas = (await prisma.$queryRawUnsafe(
        `SELECT "reservaId", "accion", "actorId", "actorRol", "fechaHora", "detalle"
         FROM "ReservaBitacora"
         WHERE "reservaId" = ANY($1::int[])
         ORDER BY "fechaHora" ASC, "id" ASC`,
        reservaIds,
      )) as Array<{
        reservaId: number;
        accion: AccionAuditoria;
        actorId: number;
        actorRol: Rol;
        fechaHora: Date | string;
        detalle: string | null;
      }>;

      for (const fila of filas) {
        const lista = resultado.get(fila.reservaId) ?? [];
        lista.push({
          accion: fila.accion,
          actorId: Number(fila.actorId),
          actorRol: fila.actorRol,
          fechaHora:
            fila.fechaHora instanceof Date
              ? fila.fechaHora.toISOString()
              : new Date(fila.fechaHora).toISOString(),
          detalle: fila.detalle ?? null,
        });
        resultado.set(fila.reservaId, lista);
      }

      if (resultado.size > 0) {
        return resultado;
      }
    } catch {
      // Fallback a memoria
    }
  }

  for (const id of reservaIds) {
    const eventosMem = bitacoraMemoria.get(id);
    if (eventosMem && eventosMem.length > 0) {
      resultado.set(id, [...eventosMem]);
    }
  }

  return resultado;
}
