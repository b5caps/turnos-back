import { PrismaClient, type Prisma } from "@prisma/client";
import type {
  CancelarReservaInput,
  EditarReservaInput,
  ListarReservasQuery,
  NotebookAsignacionesQuery,
} from "../schemas/reservas.schema.js";
import type { TokenPayload } from "./auth.service.js";

const prisma = new PrismaClient();

export class ReservaNotFoundError extends Error {}
export class ReservaConflictError extends Error {}
export class ReservaForbiddenError extends Error {}
export class ReservaBusinessError extends Error {}

const includeRecursosCompletos = {
  recursos: {
    include: {
      recurso: {
        include: {
          sala: true,
          notebook: true,
        },
      },
    },
  },
  usuario: {
    select: {
      id: true,
      nombre: true,
      apellido: true,
      email: true,
      legajo: true,
    },
  },
};

export async function listarReservas(
  filtros: ListarReservasQuery,
  usuarioAuth: TokenPayload,
) {
  const where: Prisma.ReservaWhereInput = {};

  if (usuarioAuth.rol === "ADMIN") {
    if (filtros.usuarioId) {
      where.usuarioId = filtros.usuarioId;
    }
  } else {
    where.usuarioId = usuarioAuth.id;
  }

  const ahora = new Date();

  if (filtros.estado === "activas") {
    where.fechaHoraCancelacion = null;
    where.fechaHoraFin = { gt: ahora };
  } else if (filtros.estado === "canceladas") {
    where.fechaHoraCancelacion = { not: null };
  } else if (filtros.estado === "finalizadas") {
    where.fechaHoraCancelacion = null;
    where.fechaHoraFin = { lte: ahora };
  }

  return prisma.reserva.findMany({
    where,
    orderBy: {
      fechaHoraInicio: "desc",
    },
    include: includeRecursosCompletos,
  });
}

export async function resolverTitularReserva(
  usuarioIdPropuesto: number | undefined,
  usuarioAuth: TokenPayload,
): Promise<number> {
  if (
    usuarioIdPropuesto !== undefined &&
    usuarioIdPropuesto !== usuarioAuth.id
  ) {
    if (usuarioAuth.rol !== "ADMIN") {
      throw new ReservaForbiddenError(
        "Solo los administradores pueden crear reservas en nombre de otros usuarios",
      );
    }

    const usuarioExiste = await prisma.usuario.findUnique({
      where: { id: usuarioIdPropuesto },
      select: { id: true },
    });

    if (!usuarioExiste) {
      throw new ReservaNotFoundError("El usuario especificado no existe");
    }

    return usuarioIdPropuesto;
  }

  return usuarioAuth.id;
}

export async function editarReserva(
  id: number,
  input: EditarReservaInput,
  usuarioAuth: TokenPayload,
) {
  const reserva = await prisma.reserva.findUnique({
    where: { id },
    include: includeRecursosCompletos,
  });

  if (!reserva) {
    throw new ReservaNotFoundError("Reserva no encontrada");
  }

  if (usuarioAuth.rol !== "ADMIN" && reserva.usuarioId !== usuarioAuth.id) {
    throw new ReservaForbiddenError(
      "No tienes permisos para modificar esta reserva",
    );
  }

  if (reserva.fechaHoraCancelacion !== null) {
    throw new ReservaConflictError(
      "No se puede modificar una reserva que se encuentra cancelada",
    );
  }

  if (reserva.fechaHoraCheckIn !== null) {
    throw new ReservaBusinessError(
      "No se puede modificar una reserva que ya realizó check-in",
    );
  }

  const ahora = new Date();
  if (reserva.fechaHoraFin <= ahora) {
    throw new ReservaBusinessError(
      "No se puede modificar una reserva que ya ha finalizado",
    );
  }

  return prisma.$transaction(async (tx) => {
    // Si se especifica notebookId (número o null para desvincular)
    if (input.notebookId !== undefined) {
      const notebookActual = reserva.recursos.find(
        (r) => r.recurso.notebook !== null,
      );

      if (input.notebookId === null) {
        // Desvincular notebook actual si existía
        if (notebookActual) {
          await tx.reservaRecurso.delete({
            where: {
              reservaId_recursoId: {
                reservaId: id,
                recursoId: notebookActual.recursoId,
              },
            },
          });
        }
      } else {
        const nuevaNotebookId = input.notebookId;

        // Si es distinta a la que ya tiene asignada
        if (!notebookActual || notebookActual.recursoId !== nuevaNotebookId) {
          // Verificar existencia y que sea tipo notebook
          const recursoNotebook = await tx.recurso.findUnique({
            where: { id: nuevaNotebookId },
            include: { notebook: true },
          });

          if (!recursoNotebook || !recursoNotebook.notebook) {
            throw new ReservaNotFoundError(
              "La notebook especificada no existe o no es un dispositivo válido",
            );
          }

          if (
            (recursoNotebook as unknown as { activo?: boolean }).activo ===
            false
          ) {
            throw new ReservaBusinessError(
              `La notebook '${recursoNotebook.nombre}' se encuentra inactiva y no puede asignarse`,
            );
          }

          // Verificar que no esté asignada en otra reserva en ese horario
          const conflicto = await tx.reservaRecurso.findFirst({
            where: {
              recursoId: nuevaNotebookId,
              reservaId: { not: id },
              reserva: {
                fechaHoraCancelacion: null,
                fechaHoraInicio: { lt: reserva.fechaHoraFin },
                fechaHoraFin: { gt: reserva.fechaHoraInicio },
              },
            },
          });

          if (conflicto) {
            throw new ReservaConflictError(
              `La notebook '${recursoNotebook.nombre}' no se encuentra disponible en el horario de la reserva`,
            );
          }

          // Remover la notebook previa si existía
          if (notebookActual) {
            await tx.reservaRecurso.delete({
              where: {
                reservaId_recursoId: {
                  reservaId: id,
                  recursoId: notebookActual.recursoId,
                },
              },
            });
          }

          // Asociar la nueva notebook
          await tx.reservaRecurso.create({
            data: {
              reservaId: id,
              recursoId: nuevaNotebookId,
            },
          });
        }
      }
    }

    const dataUpdate: Prisma.ReservaUpdateInput = {};
    if (input.observacion !== undefined) {
      dataUpdate.observacion = input.observacion?.trim() || null;
    }

    return tx.reserva.update({
      where: { id },
      data: dataUpdate,
      include: includeRecursosCompletos,
    });
  });
}

export async function cancelarReserva(
  id: number,
  input: CancelarReservaInput | undefined,
  usuarioAuth: TokenPayload,
) {
  const reserva = await prisma.reserva.findUnique({
    where: { id },
    include: includeRecursosCompletos,
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
    include: includeRecursosCompletos,
  });
}

export async function obtenerAsignacionesNotebooks(
  filtro: NotebookAsignacionesQuery,
  usuarioAuth: TokenPayload,
) {
  if (usuarioAuth.rol !== "ADMIN") {
    throw new ReservaForbiddenError(
      "Acceso denegado: se requieren permisos de administrador",
    );
  }

  const notebooks = await prisma.recurso.findMany({
    where: {
      notebook: { isNot: null },
    },
    include: {
      notebook: true,
    },
    orderBy: {
      nombre: "asc",
    },
  });

  // Determinar momento de consulta
  let momentoRef = new Date();
  if (filtro.momento) {
    momentoRef = new Date(filtro.momento);
  } else if (filtro.fecha) {
    const [año, mes, dia] = filtro.fecha.split("-").map(Number);
    // Usar mediodía de la fecha consultada como referencia si no se envió hora
    momentoRef = new Date(año, mes - 1, dia, 12, 0, 0);
  }

  const asignacionesPromises = notebooks.map(async (nb) => {
    // Buscar si posee una reserva activa que cubra momentoRef
    const asignacion = await prisma.reservaRecurso.findFirst({
      where: {
        recursoId: nb.id,
        reserva: {
          fechaHoraCancelacion: null,
          fechaHoraInicio: { lte: momentoRef },
          fechaHoraFin: { gte: momentoRef },
        },
      },
      include: {
        reserva: {
          include: {
            usuario: {
              select: {
                id: true,
                nombre: true,
                apellido: true,
                email: true,
                legajo: true,
              },
            },
            recursos: {
              include: {
                recurso: {
                  include: {
                    sala: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const espacioReserva = asignacion?.reserva.recursos.find(
      (r) => r.recurso.sala !== null,
    );

    return {
      notebook: {
        id: nb.id,
        nombre: nb.nombre,
        marca: nb.notebook!.marca,
        modelo: nb.notebook!.modelo,
        numeroSerie: nb.notebook!.numeroSerie,
        activo: (nb as unknown as { activo?: boolean }).activo ?? true,
      },
      estado: (asignacion ? "ASIGNADA" : "DISPONIBLE") as
        | "ASIGNADA"
        | "DISPONIBLE",
      asignacion: asignacion
        ? {
            reservaId: asignacion.reserva.id,
            fechaHoraInicio: asignacion.reserva.fechaHoraInicio.toISOString(),
            fechaHoraFin: asignacion.reserva.fechaHoraFin.toISOString(),
            espacio: espacioReserva
              ? {
                  id: espacioReserva.recurso.id,
                  nombre: espacioReserva.recurso.nombre,
                  ubicacion: espacioReserva.recurso.sala?.ubicacion ?? "",
                }
              : null,
            usuario: {
              id: asignacion.reserva.usuario.id,
              nombre: asignacion.reserva.usuario.nombre,
              apellido: asignacion.reserva.usuario.apellido,
              email: asignacion.reserva.usuario.email,
              legajo: (asignacion.reserva.usuario as any).legajo ?? null,
            },
          }
        : null,
    };
  });

  return Promise.all(asignacionesPromises);
}
