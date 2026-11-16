import type { Rol } from "@prisma/client";
import {
  ReservaConflictError,
  ReservaNotFoundError,
} from "./reservas.service.js";
import { obtenerConfiguracion } from "./configuracion.service.js";
import {
  obtenerAuditoriaReserva,
  registrarEventoReserva,
} from "./auditoria.service.js";
import { prisma } from "../lib/prisma.js";
import { bloquearRecursos, bloqueosSolapados } from "../lib/bloqueos.js";
import {
  diaSemanaFecha,
  fechaDelEstablecimiento,
  instanteDelEstablecimiento,
  minutosDelEstablecimiento,
  sumarDiasFecha,
} from "../lib/horarios.js";
import { liberarAusenciasDeRecursos } from "./ausencias.service.js";
import { reloj } from "../lib/reloj.js";

export const DURACION_HOLD_MINUTOS = 10;
export const MAX_HOLDS_ACTIVOS_POR_USUARIO = 3;

type TipoRecurso = "SALA" | "NOTEBOOK";

type ConsultaDisponibilidadInput = {
  fecha: string;
  tipo?: TipoRecurso;
};

export type ConsultaDisponibilidadNotebooksInput = {
  fecha: string;
  desde?: string;
  hasta?: string;
};

export type CrearReservaInput = {
  usuarioId: number;
  espacioId?: number;
  notebookId?: number | null;
  recursoIds?: number[];
  fechaHoraInicio: string;
  fechaHoraFin: string;
  observacion?: string;
  confirmarInmediato?: boolean;
};

export class DisponibilidadError extends Error {}

export async function consultarDisponibilidad(
  input: ConsultaDisponibilidadInput,
) {
  return consultarDisponibilidadPorTipo(input);
}

export async function consultarDisponibilidadSalas(
  input: Omit<ConsultaDisponibilidadInput, "tipo">,
) {
  return consultarDisponibilidadPorTipo({ ...input, tipo: "SALA" });
}

export async function consultarDisponibilidadNotebooks(
  input: ConsultaDisponibilidadNotebooksInput,
) {
  const resultado = await consultarDisponibilidadPorTipo({
    fecha: input.fecha,
    tipo: "NOTEBOOK",
  });

  if (!input.desde || !input.hasta) {
    return resultado;
  }

  // Parsear desde y hasta (pueden ser formato HH:mm o ISO)

  let horaInicio: Date;
  let horaFin: Date;

  if (input.desde.includes("T")) {
    horaInicio = new Date(input.desde);
  } else {
    const [h, m] = input.desde.split(":").map(Number);
    horaInicio = instanteDelEstablecimiento(input.fecha, h * 60 + m);
  }

  if (input.hasta.includes("T")) {
    horaFin = new Date(input.hasta);
  } else {
    const [h, m] = input.hasta.split(":").map(Number);
    horaFin = instanteDelEstablecimiento(input.fecha, h * 60 + m);
  }

  const recursosConTurno = resultado.recursos.map((notebook) => {
    const bloquesTurno = notebook.bloques.filter(
      (b) => b.horaInicio < horaFin && b.horaFin > horaInicio,
    );

    const disponibleEnTurno =
      bloquesTurno.length > 0 && bloquesTurno.every((b) => b.disponible);

    return {
      ...notebook,
      disponibleEnTurno,
    };
  });

  return {
    ...resultado,
    recursos: recursosConTurno,
  };
}

const DURACION_BLOQUE_MIN = 15; // 15 minutos
export function calcularFechaLimiteCheckIn(
  inicio: Date,
  fin: Date,
  minutosGracia = 15,
): Date {
  const limite = new Date(inicio.getTime() + minutosGracia * 60 * 1000);
  return limite > fin ? new Date(fin.getTime()) : limite;
}

async function consultarDisponibilidadPorTipo(
  input: ConsultaDisponibilidadInput,
) {
  const fechaConsultada = instanteDelEstablecimiento(input.fecha);
  const diaSemana = diaSemanaFecha(input.fecha);

  const config = await obtenerConfiguracion();

  const minutosApertura = config.minutosApertura;
  const minutosCierre = config.minutosCierre;

  const horarioEstablecimiento = {
    minutosApertura,
    minutosCierre,
  };

  const inicioDia = new Date(
    fechaConsultada.getTime() + minutosApertura * 60000,
  );
  const finDia = new Date(fechaConsultada.getTime() + minutosCierre * 60000);
  const limiteHold = new Date(
    reloj.ahora().getTime() - DURACION_HOLD_MINUTOS * 60 * 1000,
  );

  const incluirSala = input.tipo !== "NOTEBOOK";
  const incluirNotebook = input.tipo !== "SALA";

  const recursos = await prisma.recurso.findMany({
    where: {
      activo: true,
      ...(input.tipo
        ? { [input.tipo === "SALA" ? "sala" : "notebook"]: { isNot: null } }
        : {}),
    },
    include: {
      ...(incluirSala ? { sala: true } : {}),
      ...(incluirNotebook ? { notebook: true } : {}),
      disponibilidades: {
        where: {
          diaSemana,
        },
      },
      bloqueos: {
        where: bloqueosSolapados(inicioDia, finDia),
        select: {
          fechaHoraInicio: true,
          fechaHoraFin: true,
        },
      },
      reservas: {
        where: {
          reserva: {
            fechaHoraCancelacion: null,
            fechaHoraInicio: { lt: finDia },
            fechaHoraFin: { gt: inicioDia },
            OR: [
              { fechaHoraCheckOut: null },
              { fechaHoraCheckOut: { gt: inicioDia } },
            ],
          },
        },
        select: {
          reserva: {
            select: {
              fechaHoraInicio: true,
              fechaHoraFin: true,
              fechaHoraCheckOut: true,
              fechaHoraCancelacion: true,
            },
          },
        },
      },
      reservasPendientes: {
        where: {
          reservaPendiente: {
            fechaHoraSolicitud: {
              gt: limiteHold,
            },
            fechaHoraDeseadaInicio: { lt: finDia },
            fechaHoraDeseadaFin: { gt: inicioDia },
          },
        },
        select: {
          reservaPendiente: {
            select: {
              fechaHoraSolicitud: true,
              fechaHoraDeseadaInicio: true,
              fechaHoraDeseadaFin: true,
            },
          },
        },
      },
    },
  });

  // Generar los intervalos de 15 minutos entre apertura y cierre del día
  const intervalosBloques: {
    inicioMin: number;
    finMin: number;
    inicio: Date;
    fin: Date;
  }[] = [];
  let minActual = minutosApertura;

  while (minActual < minutosCierre) {
    const minSiguiente = minActual + DURACION_BLOQUE_MIN;
    intervalosBloques.push({
      inicioMin: minActual,
      finMin: minSiguiente,
      inicio: new Date(fechaConsultada.getTime() + minActual * 60000),
      fin: new Date(fechaConsultada.getTime() + minSiguiente * 60000),
    });
    minActual = minSiguiente;
  }


  const recursosMapeados = recursos.map((recurso) => {
    // Reservas activas dentro del horario del día consultado
    const reservasSolapadas = recurso.reservas
      .map((rr) => rr.reserva)
      .filter((reserva) => {
        if (reserva.fechaHoraCancelacion) return false;
        const finEfectivo = reserva.fechaHoraCheckOut ?? reserva.fechaHoraFin;
        return reserva.fechaHoraInicio < finDia && finEfectivo > inicioDia;
      });

    // Reservas pendientes activas (hold no expirado) dentro del horario consultado
    const pendientesSolapadas = recurso.reservasPendientes
      .map((rp) => rp.reservaPendiente)
      .filter((pendiente) => {
        return (
          pendiente.fechaHoraSolicitud > limiteHold &&
          pendiente.fechaHoraDeseadaInicio < finDia &&
          pendiente.fechaHoraDeseadaFin > inicioDia
        );
      });

    // Desglose en bloques de 15 minutos
    const bloques = intervalosBloques.map(
      ({ inicioMin, finMin, inicio: bInicio, fin: bFin }) => {
        // Valida si el bloque cae dentro de la disponibilidad del recurso para ese día
        const dentroDeHorario =
          recurso.disponibilidades.length === 0 ||
          recurso.disponibilidades.some(
            (disp) =>
              inicioMin >= disp.minutosInicio && finMin <= disp.minutosFin,
          );

        // Verifica bloqueo superpuesto con este bloque
        const hayBloqueo = recurso.bloqueos.some((bloqueo) => {
          const bloqueoInicio = new Date(bloqueo.fechaHoraInicio);
          const bloqueoFin = bloqueo.fechaHoraFin
            ? new Date(bloqueo.fechaHoraFin)
            : null;
          return (
            bloqueoInicio < bFin && (bloqueoFin ? bloqueoFin > bInicio : true)
          );
        });

        // Reservas confirmadas que solapan este bloque de 15 minutos
        const reservasBloque = reservasSolapadas.filter((reserva) => {
          const finEfectivo = reserva.fechaHoraCheckOut ?? reserva.fechaHoraFin;
          return reserva.fechaHoraInicio < bFin && finEfectivo > bInicio;
        });

        // Reservas pendientes (holds) que solapan este bloque de 15 minutos
        const pendientesBloque = pendientesSolapadas.filter((p) => {
          return (
            p.fechaHoraDeseadaInicio < bFin && p.fechaHoraDeseadaFin > bInicio
          );
        });

        const ocupacion = reservasBloque.length + pendientesBloque.length;
        const cuposLibres = Math.max(0, recurso.capacidad - ocupacion);

        let motivoNoDisponible:
          "fuera_de_horario" | "bloqueado" | "sin_cupos" | "en_gestion" | null =
          null;
        if (!dentroDeHorario) {
          motivoNoDisponible = "fuera_de_horario";
        } else if (hayBloqueo) {
          motivoNoDisponible = "bloqueado";
        } else if (cuposLibres <= 0) {
          motivoNoDisponible =
            reservasBloque.length < recurso.capacidad &&
            pendientesBloque.length > 0
              ? "en_gestion"
              : "sin_cupos";
        }

        const disponible = dentroDeHorario && !hayBloqueo && cuposLibres > 0;

        return {
          horaInicio: bInicio,
          horaFin: bFin,
          ocupacion,
          disponible,
          motivoNoDisponible,
        };
      },
    );

    const salaRecurso = "sala" in recurso ? recurso.sala : null;
    const notebookRecurso = "notebook" in recurso ? recurso.notebook : null;

    const datosEspecificos = salaRecurso
      ? { ubicacion: salaRecurso.ubicacion }
      : notebookRecurso
        ? {
            numeroSerie: notebookRecurso.numeroSerie,
            marca: notebookRecurso.marca,
            modelo: notebookRecurso.modelo,
          }
        : {};

    return {
      id: recurso.id,
      nombre: recurso.nombre,
      capacidad: recurso.capacidad,
      activo: recurso.activo,
      ...datosEspecificos,
      horariosReservados: reservasSolapadas.map((reserva) => ({
        horaInicio: reserva.fechaHoraInicio,
        horaFin: reserva.fechaHoraCheckOut ?? reserva.fechaHoraFin,
      })),
      bloques,
    };
  });

  return {
    horarioEstablecimiento,
    recursos: recursosMapeados,
  };
}

export async function crearReserva(
  input: CrearReservaInput,
  actor?: { id: number; rol: Rol },
) {
  const inicio = new Date(input.fechaHoraInicio);
  const fin = new Date(input.fechaHoraFin);

  if (
    Number.isNaN(inicio.getTime()) ||
    Number.isNaN(fin.getTime()) ||
    inicio >= fin
  ) {
    throw new DisponibilidadError("El rango horario no es válido");
  }

  const finDiaInicio = instanteDelEstablecimiento(
    sumarDiasFecha(fechaDelEstablecimiento(inicio), 1),
  );
  if (fin > finDiaInicio) {
    throw new DisponibilidadError(
      "La reserva debe comenzar y finalizar en el mismo día del establecimiento",
    );
  }

  const ahora = reloj.ahora();
  if (inicio.getTime() < ahora.getTime() - 60 * 1000) {
    throw new DisponibilidadError("No se pueden reservar horarios pasados");
  }

  // Validaciones según configuración del establecimiento
  const config = await obtenerConfiguracion();

  const duracionMinutos = (fin.getTime() - inicio.getTime()) / 60000;
  if (duracionMinutos < config.duracionMinimaMinutos) {
    throw new DisponibilidadError(
      `La duración de la reserva debe ser de al menos ${config.duracionMinimaMinutos} minutos`,
    );
  }

  if (duracionMinutos > config.duracionMaximaMinutos) {
    throw new DisponibilidadError(
      `La duración de la reserva no puede superar los ${config.duracionMaximaMinutos} minutos`,
    );
  }

  const limiteAntelacion = new Date(
    reloj.ahora().getTime() +
      config.tiempoMaximoAntelacionDias * 24 * 60 * 60 * 1000,
  );
  if (inicio > limiteAntelacion) {
    throw new DisponibilidadError(
      `No se pueden realizar reservas con más de ${config.tiempoMaximoAntelacionDias} días de antelación`,
    );
  }

  // Normalizar los IDs de recursos a partir de espacioId + notebookId o recursoIds
  const ids: number[] = [];
  if (input.espacioId !== undefined) {
    ids.push(input.espacioId);
    if (input.notebookId) {
      ids.push(input.notebookId);
    }
  } else if (input.recursoIds && input.recursoIds.length > 0) {
    ids.push(...input.recursoIds);
    if (input.notebookId) {
      ids.push(input.notebookId);
    }
  }

  const recursoIds: number[] = [...new Set(ids)].sort((a, b) => a - b);
  if (recursoIds.length === 0) {
    throw new DisponibilidadError(
      "Debe seleccionar al menos un espacio físico para la reserva",
    );
  }

  // Validar existencia, tipo y estado de los recursos seleccionados
  const recursosDb = await prisma.recurso.findMany({
    where: { id: { in: recursoIds } },
    include: {
      sala: true,
      notebook: true,
    },
  });

  if (input.notebookId !== undefined && input.notebookId !== null) {
    const recursoNotebook = recursosDb.find((r) => r.id === input.notebookId);
    if (!recursoNotebook || !recursoNotebook.notebook) {
      throw new ReservaNotFoundError(
        "La notebook especificada no existe o no es un dispositivo válido",
      );
    }
  }

  if (recursosDb.length !== recursoIds.length) {
    throw new DisponibilidadError("Uno o más recursos no existen");
  }

  if (input.espacioId !== undefined) {
    const recursoEspacio = recursosDb.find((r) => r.id === input.espacioId);
    if (!recursoEspacio || !recursoEspacio.sala) {
      throw new DisponibilidadError(
        "El espacio especificado no existe o no es una sala válida",
      );
    }
  }

  for (const r of recursosDb) {
    if (r.activo === false) {
      throw new DisponibilidadError(
        `El recurso '${r.nombre}' se encuentra inactivo y no puede ser reservado`,
      );
    }
  }

  const salas = recursosDb.filter((r) => r.sala !== null);
  const notebooks = recursosDb.filter((r) => r.notebook !== null);

  if (salas.length === 0) {
    throw new DisponibilidadError(
      "La reserva debe incluir obligatoriamente al menos un espacio físico (sala)",
    );
  }

  if (salas.length > 1) {
    throw new DisponibilidadError(
      "Solo se permite reservar un espacio físico (sala) por reserva",
    );
  }

  if (notebooks.length > 1) {
    throw new DisponibilidadError(
      "Solo se permite vincular como máximo 1 notebook institucional por reserva",
    );
  }


  const limiteHold = new Date(
    ahora.getTime() - DURACION_HOLD_MINUTOS * 60 * 1000,
  );
  const fechaLimiteCheckIn = calcularFechaLimiteCheckIn(
    inicio,
    fin,
    config.minutosGraciaCheckIn,
  );

  return prisma.$transaction(
    async (tx) => {
      // 1. Bloqueo pesimista en PostgreSQL para evitar carreras concurrentes
      await bloquearRecursos(tx, recursoIds);
      if (reloj.ahora() >= fechaLimiteCheckIn) {
        throw new DisponibilidadError(
          "El plazo de asistencia del horario solicitado ya venció",
        );
      }
      await liberarAusenciasDeRecursos(tx, recursoIds);

      // 2. Obtener recursos con sus disponibilidades y conteos de bloqueos, reservas y holds activos
      const diaSemana = diaSemanaFecha(fechaDelEstablecimiento(inicio));
      const recursos = await tx.recurso.findMany({
        where: {
          id: { in: recursoIds },
        },
        select: {
          id: true,
          nombre: true,
          capacidad: true,
          disponibilidades: {
            where: { diaSemana },
          },
          _count: {
            select: {
              bloqueos: {
                where: bloqueosSolapados(inicio, fin),
              },
              reservas: {
                where: {
                  reserva: {
                    fechaHoraCancelacion: null,
                    fechaHoraInicio: { lt: fin },
                    fechaHoraFin: { gt: inicio },
                    OR: [
                      { fechaHoraCheckOut: null },
                      { fechaHoraCheckOut: { gt: inicio } },
                    ],
                  },
                },
              },
              reservasPendientes: {
                where: {
                  reservaPendiente: {
                    fechaHoraSolicitud: { gt: limiteHold },
                    fechaHoraDeseadaInicio: { lt: fin },
                    fechaHoraDeseadaFin: { gt: inicio },
                  },
                },
              },
            },
          },
        },
      });

      if (recursos.length !== recursoIds.length) {
        throw new DisponibilidadError("Uno o más recursos no existen");
      }

      const minutosInicioReq = minutosDelEstablecimiento(inicio);
      const minutosFinReq =
        fin.getTime() === finDiaInicio.getTime()
          ? 1440
          : minutosDelEstablecimiento(fin);

      for (const recurso of recursos) {
        // Validar horario del establecimiento y del recurso para ese día
        const dentroHorarioGlobal =
          minutosInicioReq >= config.minutosApertura &&
          minutosFinReq <= config.minutosCierre;
        const dentroDeHorario =
          dentroHorarioGlobal &&
          (recurso.disponibilidades.length === 0 ||
            recurso.disponibilidades.some(
              (disp) =>
                minutosInicioReq >= disp.minutosInicio &&
                minutosFinReq <= disp.minutosFin,
            ));

        if (!dentroDeHorario) {
          throw new DisponibilidadError(
            `El recurso ${recurso.nombre} no está disponible fuera de su horario establecido`,
          );
        }

        // Validar si tiene bloqueos administrativos
        if (recurso._count.bloqueos > 0) {
          throw new ReservaConflictError(
            `El recurso ${recurso.nombre} se encuentra bloqueado por administración en el horario solicitado`,
          );
        }

        // Validar capacidad disponible considerando reservas confirmadas y reservas pendientes (holds)
        const ocupacion =
          recurso._count.reservas + recurso._count.reservasPendientes;
        if (ocupacion >= recurso.capacidad) {
          throw new ReservaConflictError(
            `El recurso ${recurso.nombre} se encuentra temporalmente apartado o reservado por otro usuario en ese horario`,
          );
        }
      }

      // 3. Si es ADMIN y solicitó confirmación inmediata: Crear directamente la Reserva
      if (input.confirmarInmediato) {
        const actorId = actor?.id ?? input.usuarioId;
        const actorRol: Rol = actor?.rol ?? "ADMIN";
        const creada = await tx.reserva.create({
          data: {
            usuarioId: input.usuarioId,
            creadoPorId: actorId,
            fechaHoraInicio: inicio,
            fechaHoraFin: fin,
            fechaLimiteCheckIn,
            fechaHoraConfirmacion: ahora,
            observacion: input.observacion,
            recursos: {
              create: recursoIds.map((recursoId: number) => ({ recursoId })),
            },
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

        await registrarEventoReserva(tx, {
          reservaId: creada.id,
          accion: "CREACION",
          actorId,
          actorRol,
          fechaHora: ahora,
        });

        const auditoria = await obtenerAuditoriaReserva(
          creada.id,
          {
            titularId: creada.usuarioId,
            creadoPorId: creada.creadoPorId,
            canceladoPorId: creada.canceladoPorId,
          },
          tx,
        );

        return { ...creada, ...auditoria };
      }

      // 4. Usuario común (o admin sin confirmación inmediata): Crear ReservaPendiente (Hold de 10 min)
      const holdsActivos = await tx.reservaPendiente.count({
        where: {
          usuarioId: input.usuarioId,
          fechaHoraSolicitud: { gt: limiteHold },
        },
      });

      if (holdsActivos >= MAX_HOLDS_ACTIVOS_POR_USUARIO) {
        throw new ReservaConflictError(
          `Has alcanzado el límite máximo de ${MAX_HOLDS_ACTIVOS_POR_USUARIO} reservas pendientes (holds) simultáneas. Confirma o libera una antes de continuar.`,
        );
      }

      return tx.reservaPendiente.create({
        data: {
          usuarioId: input.usuarioId,
          fechaHoraDeseadaInicio: inicio,
          fechaHoraDeseadaFin: fin,
          recursos: {
            create: recursoIds.map((recursoId: number) => ({ recursoId })),
          },
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
        },
      });
    },
    {
      maxWait: 10000,
      timeout: 15000,
    },
  );
}
