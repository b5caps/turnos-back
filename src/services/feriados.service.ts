import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { bloquearRecursos } from "../lib/bloqueos.js";
import {
  fechaDelEstablecimiento,
  instanteDelEstablecimiento,
  sumarDiasFecha,
} from "../lib/horarios.js";
import { reloj } from "../lib/reloj.js";
import type {
  ActualizarFeriadoInput,
  CrearFeriadoInput,
  ListarFeriadosQuery,
} from "../schemas/feriados.schema.js";
import type { TokenPayload } from "./auth.service.js";
import { cancelarReservasYHoldsEnRango } from "./bloqueos.service.js";

export class FeriadoNotFoundError extends Error {}
export class FeriadoConflictError extends Error {}
export class FeriadoForbiddenError extends Error {}
export class FeriadoBusinessError extends Error {}

function exigirAdministrador(usuario: TokenPayload) {
  if (usuario.rol !== "ADMIN") {
    throw new FeriadoForbiddenError("Se requieren permisos de administrador");
  }
}

function serializarFeriado(f: {
  id: number;
  fecha: string;
  nombre: string;
  creadoPorId: number | null;
  fechaCreacion: Date;
}) {
  return {
    id: f.id,
    fecha: f.fecha,
    nombre: f.nombre,
    creadoPorId: f.creadoPorId,
    fechaCreacion: f.fechaCreacion.toISOString(),
  };
}

export async function listarFeriadosPorAnio(query: ListarFeriadosQuery) {
  const anioActual = Number(fechaDelEstablecimiento(reloj.ahora()).slice(0, 4));
  const anio = query.anio ?? anioActual;
  const prefijo = `${anio}-`;

  const feriados = await prisma.feriado.findMany({
    where: {
      fecha: { startsWith: prefijo },
    },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
  });

  return {
    anio,
    data: feriados.map(serializarFeriado),
  };
}

/**
 * Registra un nuevo feriado manual (fecha >= hoy en Argentina) y cancela todas las
 * reservas activas y holds de ese día.
 */
export async function crearFeriado(
  input: CrearFeriadoInput,
  usuario: TokenPayload,
) {
  exigirAdministrador(usuario);

  const hoy = fechaDelEstablecimiento(reloj.ahora());
  if (input.fecha < hoy) {
    throw new FeriadoBusinessError(
      "No se puede crear un feriado en una fecha pasada",
    );
  }

  const existente = await prisma.feriado.findUnique({
    where: { fecha: input.fecha },
    select: { id: true },
  });
  if (existente) {
    throw new FeriadoConflictError(
      `Ya existe un feriado registrado para la fecha ${input.fecha}`,
    );
  }

  const inicio = instanteDelEstablecimiento(input.fecha);
  const fin = instanteDelEstablecimiento(sumarDiasFecha(input.fecha, 1));

  try {
    return await prisma.$transaction(
      async (tx) => {
        const salas = await tx.recurso.findMany({
          where: { sala: { isNot: null } },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        await bloquearRecursos(
          tx,
          salas.map((s) => s.id),
        );

        const creado = await tx.feriado.create({
          data: {
            fecha: input.fecha,
            nombre: input.nombre.trim(),
            creadoPorId: usuario.id,
          },
        });

        const { reservasCanceladas, holdsLiberados } =
          await cancelarReservasYHoldsEnRango(tx, {
            inicio,
            fin,
            recursoId: null,
            motivoCancelacion: `Feriado administrativo: ${creado.nombre}`,
            usuario,
          });

        return {
          data: serializarFeriado(creado),
          reservasCanceladas,
          holdsLiberados,
        };
      },
      { maxWait: 10000, timeout: 15000 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new FeriadoConflictError(
        `Ya existe un feriado registrado para la fecha ${input.fecha}`,
      );
    }
    throw error;
  }
}

/**
 * Actualiza fecha y/o nombre de un feriado. Exige fecha >= hoy únicamente si se cambia la fecha;
 * si la fecha cambia, cancela reservas activas y holds de la nueva fecha.
 */
export async function actualizarFeriado(
  id: number,
  input: ActualizarFeriadoInput,
  usuario: TokenPayload,
) {
  exigirAdministrador(usuario);

  const actual = await prisma.feriado.findUnique({
    where: { id },
  });
  if (!actual) {
    throw new FeriadoNotFoundError("Feriado no encontrado");
  }

  const cambiaFecha =
    input.fecha !== undefined && input.fecha !== actual.fecha;

  if (cambiaFecha) {
    const hoy = fechaDelEstablecimiento(reloj.ahora());
    if (input.fecha! < hoy) {
      throw new FeriadoBusinessError(
        "No se puede mover un feriado a una fecha pasada",
      );
    }

    const duplicado = await prisma.feriado.findFirst({
      where: { fecha: input.fecha!, id: { not: id } },
      select: { id: true },
    });
    if (duplicado) {
      throw new FeriadoConflictError(
        `Ya existe un feriado registrado para la fecha ${input.fecha}`,
      );
    }
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        if (cambiaFecha) {
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

        const actualizado = await tx.feriado.update({
          where: { id },
          data: {
            ...(input.fecha !== undefined ? { fecha: input.fecha } : {}),
            ...(input.nombre !== undefined
              ? { nombre: input.nombre.trim() }
              : {}),
          },
        });

        let reservasCanceladas = 0;
        let holdsLiberados = 0;

        if (cambiaFecha) {
          const inicio = instanteDelEstablecimiento(actualizado.fecha);
          const fin = instanteDelEstablecimiento(
            sumarDiasFecha(actualizado.fecha, 1),
          );
          const cancelacion = await cancelarReservasYHoldsEnRango(tx, {
            inicio,
            fin,
            recursoId: null,
            motivoCancelacion: `Feriado administrativo: ${actualizado.nombre}`,
            usuario,
          });
          reservasCanceladas = cancelacion.reservasCanceladas;
          holdsLiberados = cancelacion.holdsLiberados;
        }

        return {
          data: serializarFeriado(actualizado),
          reservasCanceladas,
          holdsLiberados,
        };
      },
      { maxWait: 10000, timeout: 15000 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new FeriadoConflictError(
        `Ya existe un feriado registrado para la fecha ${input.fecha}`,
      );
    }
    throw error;
  }
}
