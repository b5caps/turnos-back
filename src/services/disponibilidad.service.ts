import { PrismaClient, Prisma } from "@prisma/client";
import { ReservaConflictError } from "./reservas.service.js";

const prisma = new PrismaClient();

export const DURACION_HOLD_MINUTOS = 10;

type TipoRecurso = "SALA" | "NOTEBOOK";

type ConsultaDisponibilidadInput = {
  fecha: string;
  tipo?: TipoRecurso;
};

export type CrearReservaInput = {
  usuarioId: number;
  recursoIds: number[];
  fechaHoraInicio: string;
  fechaHoraFin: string;
  fechaLimiteCheckIn?: string;
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
  input: Omit<ConsultaDisponibilidadInput, "tipo">,
) {
  return consultarDisponibilidadPorTipo({ ...input, tipo: "NOTEBOOK" });
}

const DURACION_BLOQUE_MIN = 15; // 15 minutos
export const MINUTOS_TOLERANCIA_CHECK_IN = 15; // 15 minutos de tolerancia para check-in

export function calcularFechaLimiteCheckIn(inicio: Date, fin: Date): Date {
  const limite = new Date(
    inicio.getTime() + MINUTOS_TOLERANCIA_CHECK_IN * 60 * 1000,
  );
  return limite > fin ? new Date(fin.getTime()) : limite;
}

async function consultarDisponibilidadPorTipo(
  input: ConsultaDisponibilidadInput,
) {
  const [año, mes, dia] = input.fecha.split("-").map(Number);
  const fechaConsultada = new Date(año, mes - 1, dia);
  const diaSemana = fechaConsultada.getDay();

  // Horarios de apertura y cierre del establecimiento para el día consultado
  const disponibilidadesDia = await prisma.disponibilidad.findMany({
    where: { diaSemana },
  });

  let minutosApertura = 480; // 08:00 por defecto
  let minutosCierre = 1320; // 22:00 por defecto

  if (disponibilidadesDia.length > 0) {
    minutosApertura = Math.min(
      ...disponibilidadesDia.map((d) => d.minutosInicio),
    );
    minutosCierre = Math.max(...disponibilidadesDia.map((d) => d.minutosFin));
  }

  const horarioEstablecimiento = {
    minutosApertura,
    minutosCierre,
  };

  const inicioDia = new Date(
    fechaConsultada.getTime() + minutosApertura * 60000,
  );
  const finDia = new Date(fechaConsultada.getTime() + minutosCierre * 60000);

  const recursos = await prisma.recurso.findMany({
    where: input.tipo
      ? { [input.tipo === "SALA" ? "sala" : "notebook"]: { isNot: null } }
      : undefined,
    include: {
      sala: true,
      notebook: true,
      disponibilidades: {
        where: {
          diaSemana,
        },
      },
      bloqueos: {
        where: {
          OR: [
            {
              fechaHoraInicio: { lt: finDia },
              fechaHoraFin: { gt: inicioDia },
            },
            {
              fechaHoraInicio: { lt: finDia },
              fechaHoraFin: null,
            },
          ],
        },
      },
      reservas: {
        where: {
          reserva: {
            fechaHoraCancelacion: null,
            fechaHoraInicio: { lt: finDia },
            fechaHoraFin: { gt: inicioDia },
          },
        },
        include: {
          reserva: true,
        },
      },
      reservasPendientes: {
        where: {
          reservaPendiente: {
            fechaHoraSolicitud: {
              gt: new Date(Date.now() - DURACION_HOLD_MINUTOS * 60 * 1000),
            },
            fechaHoraDeseadaInicio: { lt: finDia },
            fechaHoraDeseadaFin: { gt: inicioDia },
          },
        },
        include: {
          reservaPendiente: true,
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

  const ahora = new Date();
  const limiteHold = new Date(
    ahora.getTime() - DURACION_HOLD_MINUTOS * 60 * 1000,
  );

  const recursosMapeados = recursos.map((recurso) => {
    // Reservas activas dentro del horario del día consultado
    const reservasSolapadas = recurso.reservas
      .map((rr) => rr.reserva)
      .filter((reserva) => {
        if (reserva.fechaHoraCancelacion) return false;
        return (
          reserva.fechaHoraInicio < finDia && reserva.fechaHoraFin > inicioDia
        );
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
        const dentroDeHorario = recurso.disponibilidades.some(
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
          return (
            reserva.fechaHoraInicio < bFin && reserva.fechaHoraFin > bInicio
          );
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
          "fuera_de_horario" | "bloqueado" | "sin_cupos" | null = null;
        if (!dentroDeHorario) {
          motivoNoDisponible = "fuera_de_horario";
        } else if (hayBloqueo) {
          motivoNoDisponible = "bloqueado";
        } else if (cuposLibres <= 0) {
          motivoNoDisponible = "sin_cupos";
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

    const datosEspecificos = recurso.sala
      ? { ubicacion: recurso.sala.ubicacion }
      : recurso.notebook
        ? {
            numeroSerie: recurso.notebook.numeroSerie,
            marca: recurso.notebook.marca,
            modelo: recurso.notebook.modelo,
          }
        : {};

    return {
      id: recurso.id,
      nombre: recurso.nombre,
      capacidad: recurso.capacidad,
      ...datosEspecificos,
      horariosReservados: reservasSolapadas.map((reserva) => ({
        horaInicio: reserva.fechaHoraInicio,
        horaFin: reserva.fechaHoraFin,
      })),
      bloques,
    };
  });

  return {
    horarioEstablecimiento,
    recursos: recursosMapeados,
  };
}

export async function crearReserva(input: CrearReservaInput) {
  const inicio = new Date(input.fechaHoraInicio);
  const fin = new Date(input.fechaHoraFin);

  if (
    Number.isNaN(inicio.getTime()) ||
    Number.isNaN(fin.getTime()) ||
    inicio >= fin
  ) {
    throw new DisponibilidadError("El rango horario no es válido");
  }

  if (!input.recursoIds || input.recursoIds.length === 0) {
    throw new DisponibilidadError("Debe seleccionar al menos un recurso");
  }

  const recursoIds: number[] = [...new Set(input.recursoIds)].sort(
    (a, b) => a - b,
  );
  const ahora = new Date();
  const limiteHold = new Date(
    ahora.getTime() - DURACION_HOLD_MINUTOS * 60 * 1000,
  );
  const fechaLimiteCalculada = calcularFechaLimiteCheckIn(inicio, fin);
  const fechaLimiteCheckIn = input.fechaLimiteCheckIn
    ? new Date(input.fechaLimiteCheckIn)
    : fechaLimiteCalculada;

  if (Number.isNaN(fechaLimiteCheckIn.getTime())) {
    throw new DisponibilidadError("La fecha límite de check-in no es válida");
  }

  const limiteMaximoTolerancia = new Date(
    Math.min(
      inicio.getTime() + MINUTOS_TOLERANCIA_CHECK_IN * 60 * 1000,
      fin.getTime(),
    ),
  );

  if (
    fechaLimiteCheckIn < inicio ||
    fechaLimiteCheckIn > limiteMaximoTolerancia
  ) {
    throw new DisponibilidadError(
      `La fecha límite de check-in debe situarse entre el inicio del turno y hasta ${MINUTOS_TOLERANCIA_CHECK_IN} minutos posteriores (tolerancia máxima sin exceder el fin de la reserva)`,
    );
  }


  return prisma.$transaction(async (tx) => {
    // 1. Bloqueo pesimista en PostgreSQL para evitar carreras concurrentes
    await tx.$queryRaw`
      SELECT id FROM "Recurso"
      WHERE id IN (${Prisma.join(recursoIds)})
      FOR UPDATE
    `;

    // 2. Obtener recursos con sus bloqueos, reservas y reservas pendientes activas
    const diaSemana = inicio.getDay();
    const recursos = await tx.recurso.findMany({
      where: {
        id: { in: recursoIds },
      },
      include: {
        disponibilidades: {
          where: { diaSemana },
        },
        bloqueos: {
          where: {
            OR: [
              {
                fechaHoraInicio: { lt: fin },
                fechaHoraFin: { gt: inicio },
              },
              {
                fechaHoraInicio: { lt: fin },
                fechaHoraFin: null,
              },
            ],
          },
        },
        reservas: {
          where: {
            reserva: {
              fechaHoraCancelacion: null,
              fechaHoraInicio: { lt: fin },
              fechaHoraFin: { gt: inicio },
            },
          },
          include: {
            reserva: true,
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
          include: {
            reservaPendiente: true,
          },
        },
      },
    });

    if (recursos.length !== recursoIds.length) {
      throw new DisponibilidadError("Uno o más recursos no existen");
    }

    const minutosInicioReq = inicio.getHours() * 60 + inicio.getMinutes();
    const minutosFinReq = fin.getHours() * 60 + fin.getMinutes();

    for (const recurso of recursos) {
      // Validar horario del recurso para ese día
      const dentroDeHorario = recurso.disponibilidades.some(
        (disp) =>
          minutosInicioReq >= disp.minutosInicio &&
          minutosFinReq <= disp.minutosFin,
      );

      if (recurso.disponibilidades.length > 0 && !dentroDeHorario) {
        throw new DisponibilidadError(
          `El recurso ${recurso.nombre} no está disponible fuera de su horario establecido`,
        );
      }

      // Validar si tiene bloqueos administrativos
      if (recurso.bloqueos.length > 0) {
        throw new ReservaConflictError(
          `El recurso ${recurso.nombre} se encuentra bloqueado por administración en el horario solicitado`,
        );
      }

      // Validar capacidad disponible considerando reservas confirmadas y reservas pendientes (holds)
      const ocupacion =
        recurso.reservas.length + recurso.reservasPendientes.length;
      if (ocupacion >= recurso.capacidad) {
        throw new ReservaConflictError(
          `El recurso ${recurso.nombre} se encuentra temporalmente apartado o reservado por otro usuario en ese horario`,
        );
      }
    }

    // 3. Si es ADMIN y solicitó confirmación inmediata: Crear directamente la Reserva
    if (input.confirmarInmediato) {
      return tx.reserva.create({
        data: {
          usuarioId: input.usuarioId,
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
            include: { recurso: true },
          },
        },
      });
    }

    // 4. Usuario común (o admin sin confirmación inmediata): Crear ReservaPendiente (Hold de 10 min)
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
          include: { recurso: true },
        },
      },
    });
  });
}
