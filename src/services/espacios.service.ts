import { PrismaClient, type Prisma } from "@prisma/client";
import type {
  ActualizarEspacioInput,
  CrearEspacioInput,
  ListarEspaciosQuery,
} from "../schemas/espacios.schema.js";
import { obtenerConfiguracion } from "./configuracion.service.js";

const prisma = new PrismaClient();

export class EspacioNotFoundError extends Error {}
export class EspacioConflictError extends Error {}
export class EspacioBusinessError extends Error {}

const DIAS_POR_DEFECTO = [1, 2, 3, 4, 5, 6]; // Lunes a Sábado

function mapearEspacio(
  r: Prisma.RecursoGetPayload<{
    include: { sala: true; disponibilidades: true };
  }>,
) {
  return {
    id: r.id,
    nombre: r.nombre,
    descripcion: r.descripcion,
    capacidad: r.capacidad,
    activo: r.activo,
    ubicacion: r.sala?.ubicacion ?? "",
    disponibilidades: r.disponibilidades.map((d) => ({
      id: d.id,
      diaSemana: d.diaSemana,
      minutosInicio: d.minutosInicio,
      minutosFin: d.minutosFin,
    })),
  };
}

export async function listarEspacios(query: ListarEspaciosQuery) {
  const where: Prisma.RecursoWhereInput = {
    sala: { isNot: null },
  };

  if (query.activo === "true") {
    where.activo = true;
  } else if (query.activo === "false") {
    where.activo = false;
  }

  const recursos = await prisma.recurso.findMany({
    where,
    include: {
      sala: true,
      disponibilidades: {
        orderBy: [{ diaSemana: "asc" }, { minutosInicio: "asc" }],
      },
    },
    orderBy: {
      nombre: "asc",
    },
  });

  return recursos.map(mapearEspacio);
}

export async function obtenerEspacioPorId(id: number) {
  const r = await prisma.recurso.findFirst({
    where: {
      id,
      sala: { isNot: null },
    },
    include: {
      sala: true,
      disponibilidades: {
        orderBy: [{ diaSemana: "asc" }, { minutosInicio: "asc" }],
      },
    },
  });

  if (!r || !r.sala) {
    throw new EspacioNotFoundError("Espacio no encontrado");
  }

  return mapearEspacio(r);
}

export async function crearEspacio(input: CrearEspacioInput) {
  let franjasDisponibilidad = input.disponibilidades;

  if (!franjasDisponibilidad || franjasDisponibilidad.length === 0) {
    const config = await obtenerConfiguracion();
    franjasDisponibilidad = DIAS_POR_DEFECTO.map((diaSemana) => ({
      diaSemana,
      minutosInicio: config.minutosApertura,
      minutosFin: config.minutosCierre,
    }));
  }

  return prisma.$transaction(async (tx) => {
    const data: Prisma.RecursoCreateInput = {
      nombre: input.nombre,
      descripcion: input.descripcion ?? "",
      capacidad: input.capacidad,
      activo: input.activo ?? true,
      sala: {
        create: {
          ubicacion: input.ubicacion,
        },
      },
      disponibilidades: {
        create: franjasDisponibilidad.map((d) => ({
          diaSemana: d.diaSemana,
          minutosInicio: d.minutosInicio,
          minutosFin: d.minutosFin,
        })),
      },
    };

    const recurso = await tx.recurso.create({
      data,
      include: {
        sala: true,
        disponibilidades: {
          orderBy: [{ diaSemana: "asc" }, { minutosInicio: "asc" }],
        },
      },
    });

    return mapearEspacio(recurso);
  });
}

export async function actualizarEspacio(
  id: number,
  input: ActualizarEspacioInput,
) {
  const existente = await prisma.recurso.findFirst({
    where: {
      id,
      sala: { isNot: null },
    },
    include: {
      sala: true,
    },
  });

  if (!existente || !existente.sala) {
    throw new EspacioNotFoundError("Espacio no encontrado");
  }

  return prisma.$transaction(async (tx) => {
    const dataRecurso: Prisma.RecursoUpdateInput = {};
    if (input.nombre !== undefined) dataRecurso.nombre = input.nombre;
    if (input.descripcion !== undefined)
      dataRecurso.descripcion = input.descripcion;
    if (input.capacidad !== undefined) dataRecurso.capacidad = input.capacidad;
    if (input.activo !== undefined) dataRecurso.activo = input.activo;

    if (input.ubicacion !== undefined) {
      await tx.sala.update({
        where: { recursoId: id },
        data: { ubicacion: input.ubicacion },
      });
    }

    if (input.disponibilidades !== undefined) {
      await tx.disponibilidad.deleteMany({
        where: { recursoId: id },
      });

      if (input.disponibilidades.length > 0) {
        await tx.disponibilidad.createMany({
          data: input.disponibilidades.map((d) => ({
            recursoId: id,
            diaSemana: d.diaSemana,
            minutosInicio: d.minutosInicio,
            minutosFin: d.minutosFin,
          })),
        });
      }
    }

    const recurso = await tx.recurso.update({
      where: { id },
      data: dataRecurso,
      include: {
        sala: true,
        disponibilidades: {
          orderBy: [{ diaSemana: "asc" }, { minutosInicio: "asc" }],
        },
      },
    });

    return mapearEspacio(recurso);
  });
}

export async function eliminarODesactivarEspacio(id: number) {
  const espacio = await prisma.recurso.findFirst({
    where: {
      id,
      sala: { isNot: null },
    },
    include: {
      sala: true,
    },
  });

  if (!espacio || !espacio.sala) {
    throw new EspacioNotFoundError("Espacio no encontrado");
  }

  const ahora = new Date();

  // Validar si posee reservas activas o futuras vigentes
  const reservaActivaOFutura = await prisma.reservaRecurso.findFirst({
    where: {
      recursoId: id,
      reserva: {
        fechaHoraCancelacion: null,
        fechaHoraFin: { gt: ahora },
      },
    },
  });

  if (reservaActivaOFutura) {
    throw new EspacioConflictError(
      "No se puede eliminar el espacio porque posee reservas activas o futuras vigentes. Puede desactivarlo en su lugar.",
    );
  }

  // Validar si posee historial de reservas
  const reservaHistorica = await prisma.reservaRecurso.findFirst({
    where: {
      recursoId: id,
    },
  });

  if (reservaHistorica) {
    // Desactivación lógica automática
    const recurso = await prisma.recurso.update({
      where: { id },
      data: { activo: false },
      include: {
        sala: true,
        disponibilidades: {
          orderBy: [{ diaSemana: "asc" }, { minutosInicio: "asc" }],
        },
      },
    });

    return {
      message:
        "El espacio posee historial de reservas asociadas y ha sido desactivado lógicamente para preservar la integridad histórica.",
      desactivado: true,
      data: mapearEspacio(recurso),
    };
  }

  // Eliminación física definitiva
  await prisma.$transaction([
    prisma.disponibilidad.deleteMany({ where: { recursoId: id } }),
    prisma.bloqueo.deleteMany({ where: { recursoId: id } }),
    prisma.sala.delete({ where: { recursoId: id } }),
    prisma.recurso.delete({ where: { id } }),
  ]);

  return {
    message: "Espacio eliminado exitosamente de forma definitiva.",
    desactivado: false,
  };
}