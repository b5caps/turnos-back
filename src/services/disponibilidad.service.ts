import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()


type ConsultaDisponibilidadInput = {
  fechaHoraInicio: string
  fechaHoraFin: string
  tipo?: TipoRecurso
}

export async function consultarDisponibilidad(input: ConsultaDisponibilidadInput) {
  const inicio = new Date(input.fechaHoraInicio)
  const fin = new Date(input.fechaHoraFin)
  const diaSemana = inicio.getDay()

  const recursos: any[] = await prisma.recurso.findMany({
    include: {
      sala: true,
      notebook: true,
      disponibilidades: {
        where: {
          diaSemana
        }
      },
      bloqueos: {
        where: {
          OR: [
            {
              fechaHoraInicio: { lt: fin },
              fechaHoraFin: { gt: inicio }
            },
            {
              fechaHoraInicio: { lte: inicio },
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

  return recursos.map((recurso: any) => {
    const tipo = recurso.sala ? 'SALA' : recurso.notebook ? 'NOTEBOOK' : 'OTRO'

    // RF-15 / RF-17: valida si el rango solicitado cae dentro de la disponibilidad semanal.
    const dentroDeHorario = recurso.disponibilidades.some((disponibilidad: any) => {
      const diaInicio = new Date(inicio)
      diaInicio.setHours(0, 0, 0, 0)

      const rangoInicio = new Date(diaInicio.getTime() + disponibilidad.minutosInicio * 60000)
      const rangoFin = new Date(diaInicio.getTime() + disponibilidad.minutosFin * 60000)

      return inicio >= rangoInicio && fin <= rangoFin
    })

    // RF-17: verifica si el recurso tiene un bloqueo que se superpone con el rango solicitado.
    const hayBloqueo = recurso.bloqueos.some((bloqueo: any) => {
      const bloqueoInicio = new Date(bloqueo.fechaHoraInicio)
      const bloqueoFin = bloqueo.fechaHoraFin ? new Date(bloqueo.fechaHoraFin) : null

      const seSolapa = bloqueoInicio < fin && (bloqueoFin ? bloqueoFin > inicio : true)
      return seSolapa
    })

    // RF-16: cuenta reservas activas que solapan el rango solicitado y calcula cupos libres.
    const reservasSolapadas = recurso.reservas
      .map((rr: any) => rr.reserva)
      .filter((reserva: any) => {
        if (reserva.fechaHoraCancelacion) return false
        return reserva.fechaHoraInicio < fin && reserva.fechaHoraFin > inicio
      })

    const ocupacion = reservasSolapadas.length
    const cuposLibres = recurso.capacidad - ocupacion

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
      id: recurso.id,
      nombre: recurso.nombre,
      capacidad: recurso.capacidad,
      ocupacion,
      cuposLibres,
      disponible,
      motivoNoDisponible,
      horariosReservados: reservasSolapadas.map((reserva: any) => ({
        horaInicio: reserva.fechaHoraInicio.toISOString(),
        horaFin: reserva.fechaHoraFin.toISOString()
      }))
    }
  })
}
