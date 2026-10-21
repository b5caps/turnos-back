import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
  fechaLimiteCheckIn?: string;
  observacion?: string;
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
  const [año, mes, dia] = input.fecha.split("-").map(Number);

  let horaInicio: Date;
  let horaFin: Date;

  if (input.desde.includes("T")) {
    horaInicio = new Date(input.desde);
  } else {
    const [h, m] = input.desde.split(":").map(Number);
    horaInicio = new Date(año, mes - 1, dia, h, m, 0);
  }

  if (input.hasta.includes("T")) {
    horaFin = new Date(input.hasta);
  } else {
    const [h, m] = input.hasta.split(":").map(Number);
    horaFin = new Date(año, mes - 1, dia, h, m, 0);
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
        return (
          reserva.fechaHoraInicio < finDia && reserva.fechaHoraFin > inicioDia
        );
      });

    // Desglose en bloques de 15 minutos
    const bloques = intervalosBloques.map(
      ({ inicioMin, finMin, inicio: bInicio, fin: bFin }) => {
        // Valida si el bloque cae dentro de la disponibilidad del recurso para ese día
        const dentroDeDisponibilidad =
          recurso.disponibilidades.length === 0 ||
          recurso.disponibilidades.some(
            (d) => inicioMin >= d.minutosInicio && finMin <= d.minutosFin,
          );

        if (!dentroDeDisponibilidad) {
          return {
            horaInicio: bInicio,
            horaFin: bFin,
            ocupacion: 0,
            disponible: false,
            motivoNoDisponible: "fuera_de_horario" as const,
          };
        }

        // Valida si existe algún bloqueo sobre el recurso en este bloque
        const bloqueado = recurso.bloqueos.some((bloqueo) => {
          if (!bloqueo.fechaHoraFin) {
            return bloqueo.fechaHoraInicio <= bInicio;
          }
          return bloqueo.fechaHoraInicio < bFin && bloqueo.fechaHoraFin > bInicio;
        });

        if (bloqueado) {
          return {
            horaInicio: bInicio,
            horaFin: bFin,
            ocupacion: 0,
            disponible: false,
            motivoNoDisponible: "bloqueado" as const,
          };
        }

        // Valida si el recurso está reservado en este bloque
        const reservasEnBloque = reservasSolapadas.filter(
          (r) => r.fechaHoraInicio < bFin && r.fechaHoraFin > bInicio,
        );

        if (reservasEnBloque.length > 0) {
          return {
            horaInicio: bInicio,
            horaFin: bFin,
            ocupacion: recurso.capacidad,
            disponible: false,
            motivoNoDisponible: "sin_cupos" as const,
          };
        }

        return {
          horaInicio: bInicio,
          horaFin: bFin,
          ocupacion: 0,
          disponible: true,
          motivoNoDisponible: null,
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
      activo: (recurso as unknown as { activo?: boolean }).activo ?? true,
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

  // Normalizar los IDs de recursos a partir de espacioId + notebookId o recursoIds
  const ids: number[] = [];
  if (input.espacioId !== undefined) {
    ids.push(input.espacioId);
    if (input.notebookId) {
      ids.push(input.notebookId);
    }
  } else if (input.recursoIds && input.recursoIds.length > 0) {
    ids.push(...input.recursoIds);
  }

  const recursoIds = [...new Set(ids)];
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

  if (recursosDb.length !== recursoIds.length) {
    throw new DisponibilidadError("Uno o más recursos no existen");
  }

  for (const r of recursosDb) {
    if ((r as unknown as { activo?: boolean }).activo === false) {
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

  if (notebooks.length > 1) {
    throw new DisponibilidadError(
      "Solo se permite vincular como máximo 1 notebook institucional por reserva",
    );
  }

  const diaStr = input.fechaHoraInicio.split("T")[0];
  const { recursos: disponibilidad } = await consultarDisponibilidad({
    fecha: diaStr,
  });
  const seleccionados = disponibilidad.filter((recurso) =>
    recursoIds.includes(recurso.id),
  );

  if (seleccionados.length !== recursoIds.length) {
    throw new DisponibilidadError("Uno o más recursos no existen en la fecha seleccionada");
  }

  const noDisponibles = seleccionados.filter((recurso) => {
    const bloquesRango = recurso.bloques.filter((b) => {
      return b.horaInicio < fin && b.horaFin > inicio;
    });

    return bloquesRango.length === 0 || bloquesRango.some((b) => !b.disponible);
  });

  if (noDisponibles.length > 0) {
    throw new DisponibilidadError(
      `Los siguientes recursos no están disponibles en el rango horario solicitado: ${noDisponibles.map((recurso) => recurso.nombre).join(", ")}`,
    );
  }

  const fechaLimiteCheckIn = input.fechaLimiteCheckIn
    ? new Date(input.fechaLimiteCheckIn)
    : inicio;

  if (
    Number.isNaN(fechaLimiteCheckIn.getTime()) ||
    fechaLimiteCheckIn > inicio
  ) {
    throw new DisponibilidadError("La fecha límite de check-in no es válida");
  }

  return prisma.$transaction(async (tx) => {
    return tx.reserva.create({
      data: {
        usuarioId: input.usuarioId,
        fechaHoraInicio: inicio,
        fechaHoraFin: fin,
        fechaLimiteCheckIn,
        observacion: input.observacion,
        recursos: {
          create: recursoIds.map((recursoId) => ({ recursoId })),
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
  });
}
