import { type Prisma } from "@prisma/client";
import type {
  ActualizarEspacioInput,
  CrearEspacioInput,
  ListarEspaciosQuery,
} from "../schemas/espacios.schema.js";
import type { TokenPayload } from "./auth.service.js";
import {
  obtenerHistorialEntidad,
  obtenerHistorialEntidades,
  registrarCambioEntidad,
  type CambioEntidad,
} from "./auditoria.service.js";
import { obtenerConfiguracion } from "./configuracion.service.js";
import { prisma } from "../lib/prisma.js";

export class EspacioNotFoundError extends Error {}
export class EspacioConflictError extends Error {}
export class EspacioBusinessError extends Error {}

const DIAS_POR_DEFECTO = [1, 2, 3, 4, 5, 6]; // Lunes a Sábado

function mapearEspacio(
  r: Prisma.RecursoGetPayload<{
    include: { sala: true; disponibilidades: true };
  }>,
  historialCambios: CambioEntidad[] = [],
) {
  const ultimo =
    historialCambios.length > 0
      ? historialCambios[historialCambios.length - 1]
      : null;

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
    modificadoPorId: ultimo?.actorId ?? null,
    historialCambios,
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

  const historiales = await obtenerHistorialEntidades(
    "ESPACIO",
    recursos.map((r) => r.id),
  );

  return recursos.map((r) => mapearEspacio(r, historiales.get(r.id) ?? []));
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

  const historial = await obtenerHistorialEntidad("ESPACIO", id);
  return mapearEspacio(r, historial);
}

export async function crearEspacio(
  input: CrearEspacioInput,
  usuarioAuth?: TokenPayload,
) {
  const nombreNormalizado = input.nombre.trim();
  const duplicado = await prisma.recurso.findFirst({
    where: {
      sala: { isNot: null },
      nombre: { equals: nombreNormalizado, mode: "insensitive" },
    },
    select: { id: true },
  });

  if (duplicado) {
    throw new EspacioConflictError(
      `Ya existe un espacio registrado con el nombre '${nombreNormalizado}'`,
    );
  }

  let franjasDisponibilidad = input.disponibilidades;

  if (!franjasDisponibilidad || franjasDisponibilidad.length === 0) {
    const config = await obtenerConfiguracion();
    franjasDisponibilidad = DIAS_POR_DEFECTO.map((diaSemana) => ({
      diaSemana,
      minutosInicio: config.minutosApertura,
      minutosFin: config.minutosCierre,
    }));
  }

  const recurso = await prisma.$transaction(async (tx) => {
    const data: Prisma.RecursoCreateInput = {
      nombre: nombreNormalizado,
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

    return tx.recurso.create({
      data,
      include: {
        sala: true,
        disponibilidades: {
          orderBy: [{ diaSemana: "asc" }, { minutosInicio: "asc" }],
        },
      },
    });
  });

  if (usuarioAuth) {
    await registrarCambioEntidad({
      entidadTipo: "ESPACIO",
      entidadId: recurso.id,
      accion: "CREACION",
      actorId: usuarioAuth.id,
      actorRol: usuarioAuth.rol,
      detalle: `Espacio '${recurso.nombre}' creado (capacidad ${recurso.capacidad})`,
    });
  }

  const historial = await obtenerHistorialEntidad("ESPACIO", recurso.id);
  return mapearEspacio(recurso, historial);
}

export async function actualizarEspacio(
  id: number,
  input: ActualizarEspacioInput,
  usuarioAuth?: TokenPayload,
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

  if (input.nombre !== undefined) {
    const nombreNormalizado = input.nombre.trim();
    const duplicado = await prisma.recurso.findFirst({
      where: {
        id: { not: id },
        sala: { isNot: null },
        nombre: { equals: nombreNormalizado, mode: "insensitive" },
      },
      select: { id: true },
    });

    if (duplicado) {
      throw new EspacioConflictError(
        `Ya existe un espacio registrado con el nombre '${nombreNormalizado}'`,
      );
    }
  }

  const desactivando = input.activo === false && existente.activo === true;
  const reduciendoCapacidad =
    input.capacidad !== undefined && input.capacidad < existente.capacidad;

  if (desactivando || reduciendoCapacidad) {
    const ahora = new Date();
    const reservaVigente = await prisma.reservaRecurso.findFirst({
      where: {
        recursoId: id,
        reserva: {
          fechaHoraCancelacion: null,
          fechaHoraCheckOut: null,
          fechaHoraFin: { gt: ahora },
        },
      },
      select: { reservaId: true },
    });

    if (reservaVigente) {
      throw new EspacioConflictError(
        desactivando
          ? "No se puede desactivar el espacio porque posee reservas activas o futuras vigentes"
          : "No se puede reducir la capacidad del espacio porque posee reservas activas o futuras vigentes",
      );
    }
  }

  const recurso = await prisma.$transaction(async (tx) => {
    const dataRecurso: Prisma.RecursoUpdateInput = {};
    if (input.nombre !== undefined) dataRecurso.nombre = input.nombre.trim();
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

    return tx.recurso.update({
      where: { id },
      data: dataRecurso,
      include: {
        sala: true,
        disponibilidades: {
          orderBy: [{ diaSemana: "asc" }, { minutosInicio: "asc" }],
        },
      },
    });
  });

  if (usuarioAuth) {
    await registrarCambioEntidad({
      entidadTipo: "ESPACIO",
      entidadId: id,
      accion: desactivando ? "DESACTIVACION" : "ACTUALIZACION",
      actorId: usuarioAuth.id,
      actorRol: usuarioAuth.rol,
      detalle: `Actualización de espacio '${recurso.nombre}'`,
    });
  }

  const historial = await obtenerHistorialEntidad("ESPACIO", id);
  return mapearEspacio(recurso, historial);
}

export async function eliminarODesactivarEspacio(
  id: number,
  usuarioAuth?: TokenPayload,
) {
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
        fechaHoraCheckOut: null,
        fechaHoraFin: { gt: ahora },
      },
    },
  });

  if (reservaActivaOFutura) {
    throw new EspacioConflictError(
      "No se puede eliminar el espacio porque posee reservas activas o futuras vigentes.",
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

    if (usuarioAuth) {
      await registrarCambioEntidad({
        entidadTipo: "ESPACIO",
        entidadId: id,
        accion: "DESACTIVACION",
        actorId: usuarioAuth.id,
        actorRol: usuarioAuth.rol,
        detalle: `Espacio '${espacio.nombre}' desactivado lógicamente`,
      });
    }

    const historial = await obtenerHistorialEntidad("ESPACIO", id);
    return {
      message:
        "El espacio posee historial de reservas asociadas y ha sido desactivado lógicamente para preservar la integridad histórica.",
      desactivado: true,
      data: mapearEspacio(recurso, historial),
    };
  }

  // Eliminación física definitiva
  await prisma.$transaction([
    prisma.disponibilidad.deleteMany({ where: { recursoId: id } }),
    prisma.bloqueo.deleteMany({ where: { recursoId: id } }),
    prisma.sala.delete({ where: { recursoId: id } }),
    prisma.recurso.delete({ where: { id } }),
  ]);

  if (usuarioAuth) {
    await registrarCambioEntidad({
      entidadTipo: "ESPACIO",
      entidadId: id,
      accion: "ELIMINACION",
      actorId: usuarioAuth.id,
      actorRol: usuarioAuth.rol,
      detalle: `Espacio '${espacio.nombre}' eliminado definitivamente`,
    });
  }

  return {
    message: "Espacio eliminado exitosamente de forma definitiva.",
    desactivado: false,
  };
}
