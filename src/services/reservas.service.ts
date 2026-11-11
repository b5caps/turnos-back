import { Prisma } from "@prisma/client";
import type {
  CancelarReservaInput,
  EditarReservaInput,
  FinalizarReservaInput,
  ListarReservasQuery,
  NotebookAsignacionesQuery,
} from "../schemas/reservas.schema.js";
import type { TokenPayload } from "./auth.service.js";
import {
  calcularFechaLimiteCheckIn,
  DURACION_HOLD_MINUTOS,
} from "./disponibilidad.service.js";
import { prisma } from "../lib/prisma.js";

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
      perfilUTN: {
        select: {
          legajo: true,
        },
      },
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

  if (filtros.estado === "pendientes") {
    const limiteExpiracion = new Date(
      ahora.getTime() - DURACION_HOLD_MINUTOS * 60 * 1000,
    );
    const wherePendiente: Prisma.ReservaPendienteWhereInput = {
      fechaHoraSolicitud: { gt: limiteExpiracion },
    };

    if (usuarioAuth.rol === "ADMIN") {
      if (filtros.usuarioId) {
        wherePendiente.usuarioId = filtros.usuarioId;
      }
    } else {
      wherePendiente.usuarioId = usuarioAuth.id;
    }

    const pendientes = await prisma.reservaPendiente.findMany({
      where: wherePendiente,
      orderBy: {
        fechaHoraSolicitud: "desc",
      },
      include: {
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
            perfilUTN: {
              select: {
                legajo: true,
              },
            },
          },
        },
      },
    });

    return pendientes.map((p) => ({
      id: p.id,
      usuarioId: p.usuarioId,
      usuario: p.usuario,
      fechaHoraInicio: p.fechaHoraDeseadaInicio,
      fechaHoraFin: p.fechaHoraDeseadaFin,
      fechaLimiteCheckIn: p.fechaHoraDeseadaInicio,
      fechaHoraConfirmacion: null,
      fechaHoraCancelacion: null,
      fechaHoraCheckIn: null,
      fechaHoraCheckOut: null,
      motivoCancelacion: null,
      observacion: null,
      fechaExpiracionHold: new Date(
        p.fechaHoraSolicitud.getTime() + DURACION_HOLD_MINUTOS * 60 * 1000,
      ),
      confirmada: false,
      esPendiente: true,
      recursos: p.recursos,
    }));
  }

  if (filtros.estado === "activas") {
    where.fechaHoraCancelacion = null;
    where.fechaHoraFin = { gt: ahora };
  } else if (filtros.estado === "canceladas") {
    where.fechaHoraCancelacion = { not: null };
  } else if (filtros.estado === "finalizadas") {
    where.fechaHoraCancelacion = null;
    where.fechaHoraFin = { lte: ahora };
  }

  const reservas = await prisma.reserva.findMany({
    where,
    orderBy: {
      fechaHoraInicio: "desc",
    },
    include: includeRecursosCompletos,
  });

  return reservas.map((r) => ({
    ...r,
    fechaExpiracionHold: null as Date | null,
    confirmada: r.fechaHoraConfirmacion !== null,
    esPendiente: false,
  }));
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
  }, { maxWait: 10000, timeout: 15000 });
}

export async function cancelarReserva(
  id: number,
  input: CancelarReservaInput | undefined,
  usuarioAuth: TokenPayload,
) {
  const reserva = await prisma.reserva.findUnique({
    where: { id },
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

  const resultado = await prisma.reserva.updateMany({
    where: {
      id,
      fechaHoraCancelacion: null,
      fechaHoraCheckIn: null,
    },
    data: {
      fechaHoraCancelacion: ahora,
      motivoCancelacion: input?.motivoCancelacion?.trim() || null,
    },
  });

  if (resultado.count === 0) {
    throw new ReservaConflictError("La reserva ya se encuentra cancelada");
  }

  return prisma.reserva.findUniqueOrThrow({
    where: { id },
    include: includeRecursosCompletos,
  });
}

export async function finalizarReserva(
  id: number,
  input: FinalizarReservaInput,
  usuarioAuth: TokenPayload,
) {
  const reserva = await prisma.reserva.findUnique({
    where: { id },
  });

  if (!reserva) {
    throw new ReservaNotFoundError("Reserva no encontrada");
  }

  if (usuarioAuth.rol !== "ADMIN" && reserva.usuarioId !== usuarioAuth.id) {
    throw new ReservaForbiddenError(
      "No tienes permisos para finalizar esta reserva",
    );
  }

  if (reserva.fechaHoraCancelacion !== null) {
    throw new ReservaConflictError("La reserva ya se encuentra cancelada");
  }

  if (reserva.fechaHoraCheckOut !== null) {
    throw new ReservaConflictError("La reserva ya se encuentra finalizada");
  }

  if (reserva.fechaHoraCheckIn === null) {
    throw new ReservaBusinessError(
      "No se puede finalizar una reserva que no ha realizado check-in",
    );
  }

  const ahora = new Date();
  if (ahora < reserva.fechaHoraInicio || ahora >= reserva.fechaHoraFin) {
    throw new ReservaBusinessError(
      "Solo se pueden finalizar reservas que se encuentren en curso en el horario actual",
    );
  }

  const resultado = await prisma.reserva.updateMany({
    where: {
      id,
      fechaHoraCancelacion: null,
      fechaHoraCheckOut: null,
      fechaHoraCheckIn: { not: null },
    },
    data: {
      fechaHoraCheckOut: ahora,
      fechaHoraFin: ahora,
      ...(input?.observacion?.trim()
        ? { observacion: input.observacion.trim() }
        : {}),
    },
  });

  if (resultado.count === 0) {
    throw new ReservaConflictError(
      "La reserva ya se encuentra finalizada o cancelada",
    );
  }

  return prisma.reserva.findUniqueOrThrow({
    where: { id },
    include: includeRecursosCompletos,
  });
}

export async function confirmarReserva(
  reservaPendienteId: number,
  usuarioAuth: TokenPayload,
) {
  return prisma.$transaction(async (tx) => {
    const pendiente = await tx.reservaPendiente.findUnique({
      where: { id: reservaPendienteId },
      include: {
        recursos: {
          include: {
            recurso: true,
          },
        },
      },
    });

    if (!pendiente) {
      throw new ReservaNotFoundError("Reserva pendiente no encontrada");
    }

    if (usuarioAuth.rol !== "ADMIN" && pendiente.usuarioId !== usuarioAuth.id) {
      throw new ReservaForbiddenError(
        "No tienes permisos para confirmar esta reserva pendiente",
      );
    }

    const ahora = new Date();
    const expiracion = new Date(
      pendiente.fechaHoraSolicitud.getTime() + DURACION_HOLD_MINUTOS * 60 * 1000,
    );
    if (ahora > expiracion) {
      await tx.reservaPendienteRecurso.deleteMany({
        where: { reservaPendienteId: pendiente.id },
      });
      await tx.reservaPendiente.delete({
        where: { id: pendiente.id },
      });
      throw new ReservaConflictError(
        "El tiempo de 10 minutos para confirmar la reserva ha expirado. El cupo ha sido liberado.",
      );
    }

    const fechaLimiteCheckIn = calcularFechaLimiteCheckIn(
      pendiente.fechaHoraDeseadaInicio,
      pendiente.fechaHoraDeseadaFin,
    );

    const recursoIds = pendiente.recursos
      .map((r) => r.recursoId)
      .sort((a, b) => a - b);
    if (recursoIds.length > 0) {
      await tx.$queryRaw`
        SELECT id FROM "Recurso"
        WHERE id IN (${Prisma.join(recursoIds)})
        FOR UPDATE
      `;
    }

    const reservaConfirmada = await tx.reserva.create({
      data: {
        usuarioId: pendiente.usuarioId,
        fechaHoraInicio: pendiente.fechaHoraDeseadaInicio,
        fechaHoraFin: pendiente.fechaHoraDeseadaFin,
        fechaLimiteCheckIn,
        fechaHoraConfirmacion: ahora,
        recursos: {
          create: pendiente.recursos.map((r) => ({ recursoId: r.recursoId })),
        },
      },
      include: includeRecursosCompletos,
    });

    await tx.reservaPendienteRecurso.deleteMany({
      where: { reservaPendienteId: pendiente.id },
    });
    await tx.reservaPendiente.delete({
      where: { id: pendiente.id },
    });

    return reservaConfirmada;
  }, { maxWait: 10000, timeout: 15000 });
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
                perfilUTN: {
                  select: {
                    legajo: true,
                  },
                },
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
              legajo: asignacion.reserva.usuario.perfilUTN?.legajo ?? null,
            },
          }
        : null,
    };
  });

  return Promise.all(asignacionesPromises);
}
