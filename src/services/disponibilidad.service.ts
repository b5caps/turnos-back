import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type TipoRecurso = 'SALA' | 'NOTEBOOK'

type ConsultaDisponibilidadInput = {
  fechaHoraInicio: string
  fechaHoraFin: string
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

const DURACION_BLOQUE_MS = 15 * 60 * 1000 // 15 minutos

async function consultarDisponibilidadPorTipo(input: ConsultaDisponibilidadInput) {
  const inicio = new Date(input.fechaHoraInicio)
  const fin = new Date(input.fechaHoraFin)

  const recursos: any[] = await prisma.recurso.findMany({
    where: input.tipo
      ? { [input.tipo === 'SALA' ? 'sala' : 'notebook']: { isNot: null } }
      : undefined,
    include: {
      sala: true,
      notebook: true,
      disponibilidades: true,
      bloqueos: {
        where: {
          OR: [
            {
              fechaHoraInicio: { lt: fin },
              fechaHoraFin: { gt: inicio }
            },
            {
              fechaHoraInicio: { lt: fin },
              fechaHoraFin: null
            }
          ]
        }
      },
      reservas: {
        include: {
          reserva: true
        }
      }
    }
  })

  // Generar los intervalos de 15 minutos entre inicio y fin
  const intervalosBloques: { inicio: Date; fin: Date }[] = []
  let tiempoActual = inicio.getTime()
  const tiempoFin = fin.getTime()

  while (tiempoActual < tiempoFin) {
    const siguienteTiempo = Math.min(tiempoActual + DURACION_BLOQUE_MS, tiempoFin)
    intervalosBloques.push({
      inicio: new Date(tiempoActual),
      fin: new Date(siguienteTiempo)
    })
    tiempoActual = siguienteTiempo
  }

  // Horarios de apertura y cierre del establecimiento para el día consultado
  const diaSemana = inicio.getDay()
  const disponibilidadesDia = await prisma.disponibilidad.findMany({
    where: { diaSemana }
  })

  let minutosApertura = 480 // 08:00 por defecto
  let minutosCierre = 1320   // 22:00 por defecto

  if (disponibilidadesDia.length > 0) {
    minutosApertura = Math.min(...disponibilidadesDia.map((d: any) => d.minutosInicio))
    minutosCierre = Math.max(...disponibilidadesDia.map((d: any) => d.minutosFin))
  }

  const diaStr = input.fechaHoraInicio.split('T')[0]
  const hhApertura = String(Math.floor(minutosApertura / 60)).padStart(2, '0')
  const mmApertura = String(minutosApertura % 60).padStart(2, '0')
  const hhCierre = String(Math.min(23, Math.floor(minutosCierre / 60))).padStart(2, '0')
  const mmCierre = String(minutosCierre >= 1440 ? 59 : minutosCierre % 60).padStart(2, '0')

  const offsetMatch = input.fechaHoraInicio.match(/([+-]\d{2}:\d{2}|Z)$/)
  const offsetStr = offsetMatch ? offsetMatch[0] : ''

  const horarioEstablecimiento = {
    horaApertura: `${diaStr}T${hhApertura}:${mmApertura}:00${offsetStr}`,
    horaCierre: `${diaStr}T${hhCierre}:${mmCierre}:00${offsetStr}`,
  }

  const data = recursos.map((recurso: any) => {
    // Reservas activas dentro del rango total consultado
    const reservasSolapadas = recurso.reservas
      .map((rr: any) => rr.reserva)
      .filter((reserva: any) => {
        if (reserva.fechaHoraCancelacion) return false
        return reserva.fechaHoraInicio < fin && reserva.fechaHoraFin > inicio
      })

    // Desglose en bloques de 15 minutos
    const bloques = intervalosBloques.map(({ inicio: bInicio, fin: bFin }) => {
      // Valida si el bloque cae dentro de la disponibilidad semanal
      const dentroDeHorario = recurso.disponibilidades.some((disp: any) => {
        if (disp.diaSemana !== bInicio.getDay()) return false

        const diaInicio = new Date(bInicio)
        diaInicio.setHours(0, 0, 0, 0)

        const rangoInicio = new Date(diaInicio.getTime() + disp.minutosInicio * 60000)
        const rangoFin = new Date(diaInicio.getTime() + disp.minutosFin * 60000)

        return bInicio >= rangoInicio && bFin <= rangoFin
      })

      // Verifica bloqueo superpuesto con este bloque
      const hayBloqueo = recurso.bloqueos.some((bloqueo: any) => {
        const bloqueoInicio = new Date(bloqueo.fechaHoraInicio)
        const bloqueoFin = bloqueo.fechaHoraFin ? new Date(bloqueo.fechaHoraFin) : null
        return bloqueoInicio < bFin && (bloqueoFin ? bloqueoFin > bInicio : true)
      })

      // Reservas activas que solapan este bloque de 15 minutos
      const reservasBloque = reservasSolapadas.filter((reserva: any) => {
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

    // El recurso completo para todo el rango se considera disponible si todos sus bloques lo están
    const disponible = bloques.length > 0 && bloques.every((b) => b.disponible)
    const primerBloqueNoDisponible = bloques.find((b) => !b.disponible)
    const motivoNoDisponible = primerBloqueNoDisponible ? primerBloqueNoDisponible.motivoNoDisponible : null

    const datosEspecificos = recurso.sala
      ? { ubicacion: recurso.sala.ubicacion }
      : {
        numeroSerie: recurso.notebook.numeroSerie,
        marca: recurso.notebook.marca,
        modelo: recurso.notebook.modelo,
      }

    return {
      id: recurso.id,
      nombre: recurso.nombre,
      capacidad: recurso.capacidad,
      ...datosEspecificos,
      disponible,
      motivoNoDisponible,
      horariosReservados: reservasSolapadas.map((reserva: any) => ({
        horaInicio: reserva.fechaHoraInicio.toISOString(),
        horaFin: reserva.fechaHoraFin.toISOString()
      })),
      bloques,
    }
  })

  return {
    horarioEstablecimiento,
    data,
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

  const { data: disponibilidad } = await consultarDisponibilidad({
    fechaHoraInicio: input.fechaHoraInicio,
    fechaHoraFin: input.fechaHoraFin,
  })
  const seleccionados = disponibilidad.filter((recurso: any) => recursoIds.includes(recurso.id))

  if (seleccionados.length !== recursoIds.length) {
    throw new DisponibilidadError('Uno o más recursos no existen')
  }

  const noDisponibles = seleccionados.filter((recurso: any) => !recurso.disponible)
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

  return prisma.$transaction(async (tx: any) => {
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
