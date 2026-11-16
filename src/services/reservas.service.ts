import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { bloquearRecursos, bloqueosSolapados } from "../lib/bloqueos.js";
import { bloquearReserva } from "../lib/reservas-lock.js";
import { obtenerConfiguracion } from "./configuracion.service.js";
import { reloj } from "../lib/reloj.js";
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
import {
  construirResumenAuditoria,
  obtenerAuditoriaReserva,
  obtenerAuditoriasReservas,
  registrarEventoReserva,
} from "./auditoria.service.js";

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

  const ahora = reloj.ahora();

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
      creadoPorId: p.usuarioId,
      canceladoPorId: null,
      canceladoPorRol: null,
      bitacora: [],
      recursos: p.recursos,
    }));
  }

  if (filtros.estado === "activas") {
    where.fechaHoraCancelacion = null;
    where.fechaHoraCheckOut = null;
    where.fechaHoraFin = { gt: ahora };
  } else if (filtros.estado === "canceladas") {
    where.fechaHoraCancelacion = { not: null };
  } else if (filtros.estado === "liberadas_por_ausencia") {
    where.tipoCancelacion = "AUSENCIA";
  } else if (filtros.estado === "finalizadas") {
    where.fechaHoraCancelacion = null;
    where.OR = [
      { fechaHoraFin: { lte: ahora } },
      { fechaHoraCheckOut: { not: null } },
    ];
  }

  const reservas = await prisma.reserva.findMany({
    where,
    orderBy: {
      fechaHoraInicio: "desc",
    },
    include: includeRecursosCompletos,
  });

  const auditoriaMap = await obtenerAuditoriasReservas(
    reservas.map((r) => r.id),
  );

  return reservas.map((r) => ({
    ...r,
    ...construirResumenAuditoria(auditoriaMap.get(r.id) ?? [], {
      titularId: r.usuarioId,
      creadoPorId: r.creadoPorId,
      canceladoPorId: r.canceladoPorId,
    }),
    fechaExpiracionHold: null as Date | null,
    confirmada: r.fechaHoraConfirmacion !== null,
    esPendiente: false,
  }));
}

export async function obtenerReservaPorId(
  id: number,
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
      "No tienes permisos para consultar esta reserva",
    );
  }

  const auditoria = await obtenerAuditoriaReserva(id, {
    titularId: reserva.usuarioId,
    creadoPorId: reserva.creadoPorId,
    canceladoPorId: reserva.canceladoPorId,
  });

  return {
    ...reserva,
    ...auditoria,
    fechaExpiracionHold: null as Date | null,
    confirmada: reserva.fechaHoraConfirmacion !== null,
    esPendiente: false,
  };
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
  return prisma.$transaction(
    async (tx) => {
      await bloquearReserva(tx, id, input.notebookId ? [input.notebookId] : []);
      const reserva = await tx.reserva.findUnique({
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

      const ahora = reloj.ahora();
      if (reserva.fechaHoraCheckOut !== null || reserva.fechaHoraFin <= ahora) {
        throw new ReservaBusinessError(
          "No se puede modificar una reserva que ya ha finalizado",
        );
      }

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
                  OR: [
                    { fechaHoraCheckOut: null },
                    { fechaHoraCheckOut: { gt: reserva.fechaHoraInicio } },
                  ],
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

      const reservaActualizada = await tx.reserva.update({
        where: { id },
        data: dataUpdate,
        include: includeRecursosCompletos,
      });

      await registrarEventoReserva(tx, {
        reservaId: id,
        accion: "EDICION",
        actorId: usuarioAuth.id,
        actorRol: usuarioAuth.rol,
        fechaHora: ahora,
      });

      const auditoria = await obtenerAuditoriaReserva(
        id,
        {
          titularId: reservaActualizada.usuarioId,
          creadoPorId: reservaActualizada.creadoPorId,
          canceladoPorId: reservaActualizada.canceladoPorId,
        },
        tx,
      );

      return { ...reservaActualizada, ...auditoria };
    },
    { maxWait: 10000, timeout: 15000 },
  );
}

export async function cancelarReserva(
  id: number,
  input: CancelarReservaInput | undefined,
  usuarioAuth: TokenPayload,
) {
  return prisma.$transaction(async (tx) => {
    await bloquearReserva(tx, id);
    const reserva = await tx.reserva.findUnique({
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

    const ahora = reloj.ahora();
    if (reserva.fechaHoraCheckOut !== null || reserva.fechaHoraFin <= ahora) {
      throw new ReservaBusinessError(
        "No se puede cancelar una reserva cuya fecha de fin ya ha transcurrido",
      );
    }

    const motivo = input?.motivoCancelacion?.trim() || null;
    const resultado = await tx.reserva.updateMany({
      where: {
        id,
        fechaHoraCancelacion: null,
        fechaHoraCheckIn: null,
      },
      data: {
        fechaHoraCancelacion: ahora,
        motivoCancelacion: motivo,
        canceladoPorId: usuarioAuth.id,
        tipoCancelacion:
          usuarioAuth.rol === "ADMIN" ? "ADMINISTRADOR" : "USUARIO",
      },
    });

    if (resultado.count === 0) {
      throw new ReservaConflictError("La reserva ya se encuentra cancelada");
    }

    await registrarEventoReserva(tx, {
      reservaId: id,
      accion: "CANCELACION",
      actorId: usuarioAuth.id,
      actorRol: usuarioAuth.rol,
      fechaHora: ahora,
      detalle: motivo,
    });

    const reservaActualizada = await tx.reserva.findUniqueOrThrow({
      where: { id },
      include: includeRecursosCompletos,
    });

    const auditoria = await obtenerAuditoriaReserva(
      id,
      {
        titularId: reservaActualizada.usuarioId,
        creadoPorId: reservaActualizada.creadoPorId,
        canceladoPorId: reservaActualizada.canceladoPorId,
      },
      tx,
    );

    return { ...reservaActualizada, ...auditoria };
  });
}

export async function finalizarReserva(
  id: number,
  input: FinalizarReservaInput,
  usuarioAuth: TokenPayload,
) {
  return prisma.$transaction(async (tx) => {
    await bloquearReserva(tx, id);
    const reserva = await tx.reserva.findUnique({
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

    const ahora = reloj.ahora();
    if (ahora < reserva.fechaHoraInicio || ahora >= reserva.fechaHoraFin) {
      throw new ReservaBusinessError(
        "Solo se pueden finalizar reservas que se encuentren en curso en el horario actual",
      );
    }

    const observacionLimpia = input?.observacion?.trim() || null;
    const resultado = await tx.reserva.updateMany({
      where: {
        id,
        fechaHoraCancelacion: null,
        fechaHoraCheckOut: null,
        fechaHoraCheckIn: { not: null },
      },
      data: {
        fechaHoraCheckOut: ahora,
        ...(observacionLimpia ? { observacion: observacionLimpia } : {}),
      },
    });

    if (resultado.count === 0) {
      throw new ReservaConflictError(
        "La reserva ya se encuentra finalizada o cancelada",
      );
    }

    await registrarEventoReserva(tx, {
      reservaId: id,
      accion: "FINALIZACION",
      actorId: usuarioAuth.id,
      actorRol: usuarioAuth.rol,
      fechaHora: ahora,
      detalle: observacionLimpia,
    });

    const reservaActualizada = await tx.reserva.findUniqueOrThrow({
      where: { id },
      include: includeRecursosCompletos,
    });

    const auditoria = await obtenerAuditoriaReserva(
      id,
      {
        titularId: reservaActualizada.usuarioId,
        creadoPorId: reservaActualizada.creadoPorId,
        canceladoPorId: reservaActualizada.canceladoPorId,
      },
      tx,
    );

    return { ...reservaActualizada, ...auditoria };
  });
}

export async function confirmarReserva(
  reservaPendienteId: number,
  usuarioAuth: TokenPayload,
) {
  const pendientePre = await prisma.reservaPendiente.findUnique({
    where: { id: reservaPendienteId },
  });

  if (!pendientePre) {
    throw new ReservaNotFoundError("Reserva pendiente no encontrada");
  }

  if (
    usuarioAuth.rol !== "ADMIN" &&
    pendientePre.usuarioId !== usuarioAuth.id
  ) {
    throw new ReservaForbiddenError(
      "No tienes permisos para confirmar esta reserva pendiente",
    );
  }

  const ahoraPre = reloj.ahora();
  const expiracionPre = new Date(
    pendientePre.fechaHoraSolicitud.getTime() +
      DURACION_HOLD_MINUTOS * 60 * 1000,
  );
  if (ahoraPre >= expiracionPre) {
    await prisma.reservaPendienteRecurso.deleteMany({
      where: { reservaPendienteId: pendientePre.id },
    });
    await prisma.reservaPendiente.deleteMany({
      where: { id: pendientePre.id },
    });
    throw new ReservaConflictError(
      "El tiempo de 10 minutos para confirmar la reserva ha expirado. El cupo ha sido liberado.",
    );
  }

  const config = await obtenerConfiguracion();
  const resultadoTx = await prisma.$transaction(
    async (tx) => {
      const referencia = await tx.reservaPendiente.findUnique({
        where: { id: reservaPendienteId },
        select: { recursos: { select: { recursoId: true } } },
      });
      if (!referencia)
        throw new ReservaNotFoundError("Reserva pendiente no encontrada");
      await bloquearRecursos(
        tx,
        referencia.recursos.map((r) => r.recursoId),
      );

      // Releer después de adquirir los locks: otra confirmación pudo consumir el hold.
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

      if (
        usuarioAuth.rol !== "ADMIN" &&
        pendiente.usuarioId !== usuarioAuth.id
      ) {
        throw new ReservaForbiddenError(
          "No tienes permisos para confirmar esta reserva pendiente",
        );
      }

      const ahora = reloj.ahora();
      const expiracion = new Date(
        pendiente.fechaHoraSolicitud.getTime() +
          DURACION_HOLD_MINUTOS * 60 * 1000,
      );
      if (ahora >= expiracion) {
        await tx.reservaPendienteRecurso.deleteMany({
          where: { reservaPendienteId: pendiente.id },
        });
        await tx.reservaPendiente.delete({
          where: { id: pendiente.id },
        });
        return { expirado: true as const };
      }

      const fechaLimiteCheckIn = calcularFechaLimiteCheckIn(
        pendiente.fechaHoraDeseadaInicio,
        pendiente.fechaHoraDeseadaFin,
        config.minutosGraciaCheckIn,
      );
      if (reloj.ahora() >= fechaLimiteCheckIn) {
        throw new ReservaConflictError(
          "El plazo de asistencia de la reserva ya venció",
        );
      }

      const bloqueo = await tx.bloqueo.findFirst({
        where: {
          recursoId: { in: pendiente.recursos.map((r) => r.recursoId) },
          ...bloqueosSolapados(
            pendiente.fechaHoraDeseadaInicio,
            pendiente.fechaHoraDeseadaFin,
          ),
        },
      });
      if (bloqueo)
        throw new ReservaConflictError(
          "El horario se encuentra bloqueado por administración. No se puede confirmar la reserva pendiente.",
        );

      const reservaConfirmada = await tx.reserva.create({
        data: {
          usuarioId: pendiente.usuarioId,
          creadoPorId: pendiente.usuarioId,
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

      await registrarEventoReserva(tx, {
        reservaId: reservaConfirmada.id,
        accion: "CONFIRMACION",
        actorId: usuarioAuth.id,
        actorRol: usuarioAuth.rol,
        fechaHora: ahora,
      });

      const auditoria = await obtenerAuditoriaReserva(
        reservaConfirmada.id,
        {
          titularId: reservaConfirmada.usuarioId,
          creadoPorId: reservaConfirmada.creadoPorId,
          canceladoPorId: reservaConfirmada.canceladoPorId,
        },
        tx,
      );

      return {
        expirado: false as const,
        data: { ...reservaConfirmada, ...auditoria },
      };
    },
    { maxWait: 10000, timeout: 15000 },
  );

  if (resultadoTx.expirado) {
    throw new ReservaConflictError(
      "El tiempo de 10 minutos para confirmar la reserva ha expirado. El cupo ha sido liberado.",
    );
  }

  return resultadoTx.data;
}

export async function liberarHold(
  reservaPendienteId: number,
  usuarioAuth: TokenPayload,
) {
  const pendiente = await prisma.reservaPendiente.findUnique({
    where: { id: reservaPendienteId },
  });

  if (!pendiente) {
    throw new ReservaNotFoundError("Reserva pendiente (hold) no encontrada");
  }

  if (usuarioAuth.rol !== "ADMIN" && pendiente.usuarioId !== usuarioAuth.id) {
    throw new ReservaForbiddenError(
      "No tienes permisos para liberar esta reserva pendiente",
    );
  }

  await prisma.$transaction([
    prisma.reservaPendienteRecurso.deleteMany({
      where: { reservaPendienteId: pendiente.id },
    }),
    prisma.reservaPendiente.deleteMany({
      where: { id: pendiente.id },
    }),
  ]);
}

export async function liberarHoldsDeUsuario(usuarioId: number): Promise<number> {
  const pendientes = await prisma.reservaPendiente.findMany({
    where: { usuarioId },
    select: { id: true },
  });

  if (pendientes.length === 0) {
    return 0;
  }

  const ids = pendientes.map((p) => p.id);
  await prisma.$transaction([
    prisma.reservaPendienteRecurso.deleteMany({
      where: { reservaPendienteId: { in: ids } },
    }),
    prisma.reservaPendiente.deleteMany({
      where: { id: { in: ids } },
    }),
  ]);

  return ids.length;
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

  const notebookIds = notebooks.map((nb) => nb.id);
  const asignacionesDb =
    notebookIds.length > 0
      ? await prisma.reservaRecurso.findMany({
          where: {
            recursoId: { in: notebookIds },
            reserva: {
              fechaHoraCancelacion: null,
              fechaHoraInicio: { lte: momentoRef },
              fechaHoraFin: { gte: momentoRef },
              OR: [
                { fechaHoraCheckOut: null },
                { fechaHoraCheckOut: { gt: momentoRef } },
              ],
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
        })
      : [];

  const asignacionPorNotebook = new Map<
    number,
    (typeof asignacionesDb)[number]
  >();
  for (const a of asignacionesDb) {
    if (!asignacionPorNotebook.has(a.recursoId)) {
      asignacionPorNotebook.set(a.recursoId, a);
    }
  }

  return notebooks.map((nb) => {
    const asignacion = asignacionPorNotebook.get(nb.id) ?? null;

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
        "ASIGNADA" | "DISPONIBLE",
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
}
