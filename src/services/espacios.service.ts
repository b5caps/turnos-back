import { PrismaClient, type Prisma } from "@prisma/client";
import type {
  ActualizarEspacioInput,
  CrearEspacioInput,
  ListarEspaciosQuery,
} from "../schemas/espacios.schema.js";

const prisma = new PrismaClient();

export class EspacioNotFoundError extends Error {}
export class EspacioConflictError extends Error {}
export class EspacioBusinessError extends Error {}

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
    },
    orderBy: {
      nombre: "asc",
    },
  });

  return recursos.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    descripcion: r.descripcion,
    capacidad: r.capacidad,
    activo: (r as unknown as { activo?: boolean }).activo ?? true,
    ubicacion: r.sala?.ubicacion ?? "",
  }));
}

export async function obtenerEspacioPorId(id: number) {
  const r = await prisma.recurso.findFirst({
    where: {
      id,
      sala: { isNot: null },
    },
    include: {
      sala: true,
    },
  });

  if (!r || !r.sala) {
    throw new EspacioNotFoundError("Espacio no encontrado");
  }

  return {
    id: r.id,
    nombre: r.nombre,
    descripcion: r.descripcion,
    capacidad: r.capacidad,
    activo: (r as unknown as { activo?: boolean }).activo ?? true,
    ubicacion: r.sala.ubicacion,
  };
}

export async function crearEspacio(input: CrearEspacioInput) {
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
    };

    const recurso = await tx.recurso.create({
      data,
      include: {
        sala: true,
      },
    });

    return {
      id: recurso.id,
      nombre: recurso.nombre,
      descripcion: recurso.descripcion,
      capacidad: recurso.capacidad,
      activo: (recurso as unknown as { activo?: boolean }).activo ?? true,
      ubicacion: recurso.sala!.ubicacion,
    };
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

    const recurso = await tx.recurso.update({
      where: { id },
      data: dataRecurso,
      include: { sala: true },
    });

    return {
      id: recurso.id,
      nombre: recurso.nombre,
      descripcion: recurso.descripcion,
      capacidad: recurso.capacidad,
      activo: (recurso as unknown as { activo?: boolean }).activo ?? true,
      ubicacion: recurso.sala!.ubicacion,
    };
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
      include: { sala: true },
    });

    return {
      message:
        "El espacio posee historial de reservas asociadas y ha sido desactivado lógicamente para preservar la integridad histórica.",
      desactivado: true,
      data: {
        id: recurso.id,
        nombre: recurso.nombre,
        descripcion: recurso.descripcion,
        capacidad: recurso.capacidad,
        activo: false,
        ubicacion: recurso.sala!.ubicacion,
      },
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
