import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { bloquearRecursos, bloqueosSolapados } from "../lib/bloqueos.js";
import { bloquearReserva } from "../lib/reservas-lock.js";
import { reloj } from "../lib/reloj.js";
import { instanteDelEstablecimiento, sumarDiasFecha } from "../lib/horarios.js";
import { registrarEventoReserva } from "./auditoria.service.js";
import type {
  CrearBloqueoGlobalInput,
  CrearBloqueoInput,
  ListarBloqueosCalendarioQuery,
  ListarBloqueosQuery,
} from "../schemas/bloqueos.schema.js";
import type { TokenPayload } from "./auth.service.js";

export class BloqueoNotFoundError extends Error {}
export class BloqueoForbiddenError extends Error {}
export class BloqueoBusinessError extends Error {}

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

function resolverRangoBloqueo(
  input: CrearBloqueoInput | CrearBloqueoGlobalInput,
): { inicio: Date; fin: Date | null } {
  if ("tipo" in input && input.tipo === "DIAS_COMPLETOS") {
    return {
      inicio: instanteDelEstablecimiento(input.fechaDesde),
      fin: instanteDelEstablecimiento(sumarDiasFecha(input.fechaHasta, 1)),
    };
  }

  return {
    inicio: new Date(input.fechaHoraInicio),
    fin: input.fechaHoraFin ? new Date(input.fechaHoraFin) : null,
  };
}

function parsearLimiteCalendario(valor: string, esFin: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return esFin
      ? instanteDelEstablecimiento(sumarDiasFecha(valor, 1))
      : instanteDelEstablecimiento(valor);
  }
  return new Date(valor);
}

export async function crearBloqueo(
  id: number,
  input: CrearBloqueoInput,
  usuario: TokenPayload,
) {
  exigirAdministrador(usuario);
  const { inicio, fin } = resolverRangoBloqueo(input);

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

/**
 * Cancela todas las reservas activas (incluso en curso con check-in) y libera los holds
 * solapados con el intervalo [inicio, fin), registrando el evento de cancelación en ReservaBitacora.
 */
export async function cancelarReservasYHoldsEnRango(
  tx: Prisma.TransactionClient,
  params: {
    inicio: Date;
    fin: Date | null;
    recursoId: number | null;
    motivoCancelacion: string;
    usuario: TokenPayload;
  },
): Promise<{ reservasCanceladas: number; holdsLiberados: number }> {
  const { inicio, fin, recursoId, motivoCancelacion, usuario } = params;
  const ahora = reloj.ahora();
  const puntoCorteFin = fin === null || inicio > ahora ? inicio : ahora;

  const afectadas = await tx.reserva.findMany({
    where: {
      fechaHoraCancelacion: null,
      fechaHoraCheckOut: null,
      fechaHoraFin: { gt: puntoCorteFin },
      ...(fin ? { fechaHoraInicio: { lt: fin } } : {}),
      ...(recursoId !== null ? { recursos: { some: { recursoId } } } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  let reservasCanceladas = 0;
  for (const { id: reservaId } of afectadas) {
    await bloquearReserva(tx, reservaId);
    const res = await tx.reserva.updateMany({
      where: {
        id: reservaId,
        fechaHoraCancelacion: null,
        fechaHoraCheckOut: null,
      },
      data: {
        fechaHoraCancelacion: ahora,
        motivoCancelacion,
        canceladoPorId: usuario.id,
        tipoCancelacion: "ADMINISTRADOR",
      },
    });
    if (res.count > 0) {
      reservasCanceladas += res.count;
      await registrarEventoReserva(tx, {
        reservaId,
        accion: "CANCELACION",
        actorId: usuario.id,
        actorRol: usuario.rol,
        fechaHora: ahora,
        detalle: motivoCancelacion,
      });
    }
  }

  const holdsAfectados = await tx.reservaPendiente.findMany({
    where: {
      fechaHoraDeseadaFin: { gt: inicio },
      ...(fin ? { fechaHoraDeseadaInicio: { lt: fin } } : {}),
      ...(recursoId !== null ? { recursos: { some: { recursoId } } } : {}),
    },
    select: { id: true },
  });

  if (holdsAfectados.length > 0) {
    const holdIds = holdsAfectados.map((h) => h.id);
    await tx.reservaPendienteRecurso.deleteMany({
      where: { reservaPendienteId: { in: holdIds } },
    });
    await tx.reservaPendiente.deleteMany({
      where: { id: { in: holdIds } },
    });
  }

  return {
    reservasCanceladas,
    holdsLiberados: holdsAfectados.length,
  };
}

/**
 * Crea un bloqueo por espacio (recursoId) o global (recursoId: null) y cancela todas las reservas
 * activas y holds solapados con el intervalo bloqueado.
 */
export async function crearBloqueoGlobal(
  input: CrearBloqueoGlobalInput,
  usuario: TokenPayload,
) {
  exigirAdministrador(usuario);
  const { inicio, fin } = resolverRangoBloqueo(input);
  const recursoId = input.recursoId ?? null;

  return prisma.$transaction(
    async (tx) => {
      if (recursoId !== null) {
        await bloquearRecursos(tx, [recursoId]);
        await exigirEspacio(tx, recursoId);
      } else {
        const salas = await tx.recurso.findMany({
          where: { sala: { isNot: null } },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        await bloquearRecursos(
          tx,
          salas.map((s) => s.id),
        );
      }

      const bloqueo = await tx.bloqueo.create({
        data: {
          recursoId,
          fechaHoraInicio: inicio,
          fechaHoraFin: fin,
          motivo: input.motivo,
          creadoPorId: usuario.id,
        },
        include: {
          recurso: {
            select: {
              id: true,
              nombre: true,
              sala: { select: { ubicacion: true } },
            },
          },
        },
      });

      const { reservasCanceladas, holdsLiberados } =
        await cancelarReservasYHoldsEnRango(tx, {
          inicio,
          fin,
          recursoId,
          motivoCancelacion: `Bloqueo administrativo: ${input.motivo}`,
          usuario,
        });

      return {
        bloqueo,
        reservasCanceladas,
        holdsLiberados,
      };
    },
    { maxWait: 10000, timeout: 15000 },
  );
}

/**
 * Lista todos los bloqueos (por espacio y globales) que solapan un rango para el calendario mensual.
 */
export async function listarBloqueosCalendario(
  query: ListarBloqueosCalendarioQuery,
  usuario: TokenPayload,
) {
  exigirAdministrador(usuario);

  const desdeDate = query.desde
    ? parsearLimiteCalendario(query.desde, false)
    : null;
  const hastaDate = query.hasta
    ? parsearLimiteCalendario(query.hasta, true)
    : null;

  if (desdeDate && hastaDate && hastaDate <= desdeDate) {
    throw new BloqueoBusinessError(
      "La fecha 'hasta' debe ser posterior o igual a 'desde'",
    );
  }

  const where: Prisma.BloqueoWhereInput = {};
  if (desdeDate) {
    Object.assign(where, bloqueosSolapados(desdeDate, hastaDate));
  } else if (hastaDate) {
    where.fechaHoraInicio = { lt: hastaDate };
  }

  return prisma.bloqueo.findMany({
    where,
    include: {
      recurso: {
        select: {
          id: true,
          nombre: true,
          sala: { select: { ubicacion: true } },
        },
      },
    },
    orderBy: [{ fechaHoraInicio: "asc" }, { id: "asc" }],
  });
}

/**
 * Elimina un bloqueo por su ID (aplica tanto a bloqueos de sala como globales).
 */
export async function eliminarBloqueoPorId(
  id: number,
  usuario: TokenPayload,
) {
  exigirAdministrador(usuario);
  const resultado = await prisma.bloqueo.deleteMany({ where: { id } });
  if (resultado.count === 0) {
    throw new BloqueoNotFoundError("Bloqueo no encontrado");
  }
}
