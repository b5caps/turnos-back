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

export type TipoEntidadAuditoria = "ESPACIO" | "CONFIGURACION";
export type AccionEntidadAuditoria =
  | "CREACION"
  | "ACTUALIZACION"
  | "DESACTIVACION"
  | "ELIMINACION";

export interface CambioEntidad {
  accion: AccionEntidadAuditoria;
  actorId: number;
  actorRol: Rol;
  fechaHora: string;
  detalle: string | null;
}

const entidadBitacoraMemoria = new Map<string, CambioEntidad[]>();
let tablaEntidadAsegurada = false;

async function asegurarTablaEntidadBitacora(): Promise<boolean> {
  if (tablaEntidadAsegurada) return true;
  if (typeof prisma.$executeRawUnsafe !== "function") return false;

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "EntidadBitacora" (
        "id" SERIAL PRIMARY KEY,
        "entidadTipo" TEXT NOT NULL,
        "entidadId" INTEGER NOT NULL,
        "accion" TEXT NOT NULL,
        "actorId" INTEGER NOT NULL,
        "actorRol" TEXT NOT NULL,
        "fechaHora" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "detalle" TEXT
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "EntidadBitacora_tipo_id_idx"
      ON "EntidadBitacora" ("entidadTipo", "entidadId")
    `);
    tablaEntidadAsegurada = true;
    return true;
  } catch {
    return false;
  }
}

export async function registrarCambioEntidad(params: {
  entidadTipo: TipoEntidadAuditoria;
  entidadId: number;
  accion: AccionEntidadAuditoria;
  actorId: number;
  actorRol: Rol;
  detalle?: string | null;
}): Promise<void> {
  const fecha = new Date();
  const evento: CambioEntidad = {
    accion: params.accion,
    actorId: params.actorId,
    actorRol: params.actorRol,
    fechaHora: fecha.toISOString(),
    detalle: params.detalle ?? null,
  };

  const key = `${params.entidadTipo}:${params.entidadId}`;
  const lista = entidadBitacoraMemoria.get(key) ?? [];
  lista.push(evento);
  entidadBitacoraMemoria.set(key, lista);

  const ok = await asegurarTablaEntidadBitacora();
  if (ok && typeof prisma.$executeRawUnsafe === "function") {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "EntidadBitacora" ("entidadTipo", "entidadId", "accion", "actorId", "actorRol", "fechaHora", "detalle")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        params.entidadTipo,
        params.entidadId,
        params.accion,
        params.actorId,
        params.actorRol,
        fecha,
        params.detalle ?? null,
      );
    } catch {
      // Mantiene respaldo en memoria
    }
  }
}

export async function obtenerHistorialEntidades(
  entidadTipo: TipoEntidadAuditoria,
  entidadIds: number[],
): Promise<Map<number, CambioEntidad[]>> {
  const resultado = new Map<number, CambioEntidad[]>();
  if (entidadIds.length === 0) return resultado;

  const ok = await asegurarTablaEntidadBitacora();
  if (ok && typeof prisma.$queryRawUnsafe === "function") {
    try {
      const filas = (await prisma.$queryRawUnsafe(
        `SELECT "entidadId", "accion", "actorId", "actorRol", "fechaHora", "detalle"
         FROM "EntidadBitacora"
         WHERE "entidadTipo" = $1 AND "entidadId" = ANY($2::int[])
         ORDER BY "fechaHora" ASC, "id" ASC`,
        entidadTipo,
        entidadIds,
      )) as Array<{
        entidadId: number;
        accion: AccionEntidadAuditoria;
        actorId: number;
        actorRol: Rol;
        fechaHora: Date | string;
        detalle: string | null;
      }>;

      for (const fila of filas) {
        const eid = Number(fila.entidadId);
        const lista = resultado.get(eid) ?? [];
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
        resultado.set(eid, lista);
      }

      if (resultado.size > 0) {
        return resultado;
      }
    } catch {
      // Fallback a memoria
    }
  }

  for (const id of entidadIds) {
    const eventos = entidadBitacoraMemoria.get(`${entidadTipo}:${id}`);
    if (eventos && eventos.length > 0) {
      resultado.set(id, [...eventos]);
    }
  }

  return resultado;
}

export async function obtenerHistorialEntidad(
  entidadTipo: TipoEntidadAuditoria,
  entidadId: number,
): Promise<CambioEntidad[]> {
  const map = await obtenerHistorialEntidades(entidadTipo, [entidadId]);
  return map.get(entidadId) ?? [];
}
