import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type TipoRecurso = 'SALA' | 'NOTEBOOK'

type ConsultaDisponibilidadInput = {
  fecha: string
  tipo?: TipoRecurso
}

export type CrearReservaInput = {
  usuarioId: number
  recursoIds: number[]
  fechaHoraInicio: string
  fechaHoraFin: string
  fechaLimiteCheckIn?: string
  observacion?: string
}

export class DisponibilidadError extends Error { }

export async function consultarDisponibilidad(input: ConsultaDisponibilidadInput) {
  return consultarDisponibilidadPorTipo(input)
}

export async function consultarDisponibilidadSalas(input: Omit<ConsultaDisponibilidadInput, 'tipo'>) {
  return consultarDisponibilidadPorTipo({ ...input, tipo: 'SALA' })
}

export async function consultarDisponibilidadNotebooks(input: Omit<ConsultaDisponibilidadInput, 'tipo'>) {
  return consultarDisponibilidadPorTipo({ ...input, tipo: 'NOTEBOOK' })
}

const DURACION_BLOQUE_MIN = 15 // 15 minutos

async function consultarDisponibilidadPorTipo(input: ConsultaDisponibilidadInput) {
  const diaStr = input.fecha.split('T')[0]
  const [año, mes, dia] = diaStr.split('-').map(Number)
  const fechaConsultada = new Date(año, mes - 1, dia)
  const diaSemana = fechaConsultada.getDay()

  // Horarios de apertura y cierre del establecimiento para el día consultado
  const disponibilidadesDia = await prisma.disponibilidad.findMany({
    where: { diaSemana }
  })

  let minutosApertura = 480 // 08:00 por defecto
  let minutosCierre = 1320   // 22:00 por defecto

  if (disponibilidadesDia.length > 0) {
    minutosApertura = Math.min(...disponibilidadesDia.map((d) => d.minutosInicio))
    minutosCierre = Math.max(...disponibilidadesDia.map((d) => d.minutosFin))
  }

  const horarioEstablecimiento = {
    minutosApertura,
    minutosCierre,
  }

  const inicioDia = new Date(fechaConsultada.getTime() + minutosApertura * 60000)
  const finDia = new Date(fechaConsultada.getTime() + minutosCierre * 60000)

  const recursos = await prisma.recurso.findMany({
    where: input.tipo
      ? { [input.tipo === 'SALA' ? 'sala' : 'notebook']: { isNot: null } }
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
              fechaHoraFin: { gt: inicioDia }
            },
            {
              fechaHoraInicio: { lt: finDia },
              fechaHoraFin: null
            }
          ]
        }
      },
      reservas: {
        where: {
          reserva: {
            fechaHoraCancelacion: null,
            fechaHoraInicio: { lt: finDia },
            fechaHoraFin: { gt: inicioDia }
          }
        },
        include: {
          reserva: true
        }
      }
    }
  })

  // Generar los intervalos de 15 minutos entre apertura y cierre del día
  const intervalosBloques: { inicioMin: number; finMin: number; inicio: Date; fin: Date }[] = []
  let minActual = minutosApertura

  while (minActual < minutosCierre) {
    const minSiguiente = minActual + DURACION_BLOQUE_MIN
    intervalosBloques.push({
      inicioMin: minActual,
      finMin: minSiguiente,
      inicio: new Date(fechaConsultada.getTime() + minActual * 60000),
      fin: new Date(fechaConsultada.getTime() + minSiguiente * 60000),
    })
    minActual = minSiguiente
  }

  const recursosMapeados = recursos.map((recurso) => {
    // Reservas activas dentro del horario del día consultado
    const reservasSolapadas = recurso.reservas
      .map((rr) => rr.reserva)
      .filter((reserva) => {
        if (reserva.fechaHoraCancelacion) return false
        return reserva.fechaHoraInicio < finDia && reserva.fechaHoraFin > inicioDia
      })

    // Desglose en bloques de 15 minutos
    const bloques = intervalosBloques.map(({ inicioMin, finMin, inicio: bInicio, fin: bFin }) => {
      // Valida si el bloque cae dentro de la disponibilidad del recurso para ese día
      const dentroDeHorario = recurso.disponibilidades.some(
        (disp) => inicioMin >= disp.minutosInicio && finMin <= disp.minutosFin
      )

      // Verifica bloqueo superpuesto con este bloque
      const hayBloqueo = recurso.bloqueos.some((bloqueo) => {
        const bloqueoInicio = new Date(bloqueo.fechaHoraInicio)
        const bloqueoFin = bloqueo.fechaHoraFin ? new Date(bloqueo.fechaHoraFin) : null
        return bloqueoInicio < bFin && (bloqueoFin ? bloqueoFin > bInicio : true)
      })

      // Reservas activas que solapan este bloque de 15 minutos
      const reservasBloque = reservasSolapadas.filter((reserva) => {
        return reserva.fechaHoraInicio < bFin && reserva.fechaHoraFin > bInicio
      })

      const ocupacion = reservasBloque.length
      const cuposLibres = Math.max(0, recurso.capacidad - ocupacion)

      let motivoNoDisponible: 'fuera_de_horario' | 'bloqueado' | 'sin_cupos' | null = null
      if (!dentroDeHorario) {
        motivoNoDisponible = 'fuera_de_horario'
      } else if (hayBloqueo) {
        motivoNoDisponible = 'bloqueado'
      } else if (cuposLibres <= 0) {
        motivoNoDisponible = 'sin_cupos'
      }

      const disponible = dentroDeHorario && !hayBloqueo && cuposLibres > 0

      return {
        horaInicio: bInicio.toISOString(),
        horaFin: bFin.toISOString(),
        ocupacion,
        disponible,
        motivoNoDisponible,
      }
    })

    const datosEspecificos = recurso.sala
      ? { ubicacion: recurso.sala.ubicacion }
      : recurso.notebook
        ? {
          numeroSerie: recurso.notebook.numeroSerie,
          marca: recurso.notebook.marca,
          modelo: recurso.notebook.modelo,
        }
        : {}

    return {
      id: recurso.id,
      nombre: recurso.nombre,
      capacidad: recurso.capacidad,
      ...datosEspecificos,
      horariosReservados: reservasSolapadas.map((reserva) => ({
        horaInicio: reserva.fechaHoraInicio.toISOString(),
        horaFin: reserva.fechaHoraFin.toISOString()
      })),
      bloques,
    }
  })

  return {
    horarioEstablecimiento,
    recursos: recursosMapeados,
  }
}

export async function crearReserva(input: CrearReservaInput) {
  const inicio = new Date(input.fechaHoraInicio)
  const fin = new Date(input.fechaHoraFin)

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || inicio >= fin) {
    throw new DisponibilidadError('El rango horario no es válido')
  }

  const recursoIds = [...new Set(input.recursoIds)]
  if (recursoIds.length === 0) {
    throw new DisponibilidadError('Debe seleccionar al menos un recurso')
  }

  const diaStr = input.fechaHoraInicio.split('T')[0]
  const { recursos: disponibilidad } = await consultarDisponibilidad({
    fecha: diaStr,
  })
  const seleccionados = disponibilidad.filter((recurso) => recursoIds.includes(recurso.id))

  if (seleccionados.length !== recursoIds.length) {
    throw new DisponibilidadError('Uno o más recursos no existen')
  }

  const noDisponibles = seleccionados.filter((recurso) => {
    const bloquesRango = recurso.bloques.filter((b) => {
      const bInicio = new Date(b.horaInicio)
      const bFin = new Date(b.horaFin)
      return bInicio < fin && bFin > inicio
    })

    return bloquesRango.length === 0 || bloquesRango.some((b) => !b.disponible)
  })

  if (noDisponibles.length > 0) {
    throw new DisponibilidadError(
      `Los recursos no están disponibles: ${noDisponibles.map((recurso) => recurso.nombre).join(', ')}`
    )
  }

  const fechaLimiteCheckIn = input.fechaLimiteCheckIn
    ? new Date(input.fechaLimiteCheckIn)
    : inicio

  if (Number.isNaN(fechaLimiteCheckIn.getTime()) || fechaLimiteCheckIn > inicio) {
    throw new DisponibilidadError('La fecha límite de check-in no es válida')
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
          include: { recurso: true },
        },
      },
    })
  })
}
