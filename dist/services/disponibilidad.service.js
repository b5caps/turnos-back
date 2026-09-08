import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export class DisponibilidadError extends Error {
}
export async function consultarDisponibilidad(input) {
    const inicio = new Date(input.fechaHoraInicio);
    const fin = new Date(input.fechaHoraFin);
    const diaSemana = inicio.getDay();
    const recursos = await prisma.recurso.findMany({
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
    });
    return recursos.map((recurso) => {
        const tipo = recurso.sala ? 'SALA' : recurso.notebook ? 'NOTEBOOK' : 'OTRO';
        // RF-15 / RF-17: valida si el rango solicitado cae dentro de la disponibilidad semanal.
        const dentroDeHorario = recurso.disponibilidades.some((disponibilidad) => {
            const diaInicio = new Date(inicio);
            diaInicio.setHours(0, 0, 0, 0);
            const rangoInicio = new Date(diaInicio.getTime() + disponibilidad.minutosInicio * 60000);
            const rangoFin = new Date(diaInicio.getTime() + disponibilidad.minutosFin * 60000);
            return inicio >= rangoInicio && fin <= rangoFin;
        });
        // RF-17: verifica si el recurso tiene un bloqueo que se superpone con el rango solicitado.
        const hayBloqueo = recurso.bloqueos.some((bloqueo) => {
            const bloqueoInicio = new Date(bloqueo.fechaHoraInicio);
            const bloqueoFin = bloqueo.fechaHoraFin ? new Date(bloqueo.fechaHoraFin) : null;
            const seSolapa = bloqueoInicio < fin && (bloqueoFin ? bloqueoFin > inicio : true);
            return seSolapa;
        });
        // RF-16: cuenta reservas activas que solapan el rango solicitado y calcula cupos libres.
        const reservasSolapadas = recurso.reservas
            .map((rr) => rr.reserva)
            .filter((reserva) => {
            if (reserva.fechaHoraCancelacion)
                return false;
            return reserva.fechaHoraInicio < fin && reserva.fechaHoraFin > inicio;
        });
        const ocupacion = reservasSolapadas.length;
        const cuposLibres = recurso.capacidad - ocupacion;
        let motivoNoDisponible = null;
        if (!dentroDeHorario) {
            motivoNoDisponible = 'fuera_de_horario';
        }
        else if (hayBloqueo) {
            motivoNoDisponible = 'bloqueado';
        }
        else if (cuposLibres <= 0) {
            motivoNoDisponible = 'sin_cupos';
        }
        const disponible = dentroDeHorario && !hayBloqueo && cuposLibres > 0;
        return {
            id: recurso.id,
            nombre: recurso.nombre,
            tipo,
            capacidad: recurso.capacidad,
            ocupacion,
            cuposLibres,
            disponible,
            motivoNoDisponible,
            horariosReservados: reservasSolapadas.map((reserva) => ({
                horaInicio: reserva.fechaHoraInicio.toISOString(),
                horaFin: reserva.fechaHoraFin.toISOString()
            }))
        };
    });
}
export async function crearReserva(input) {
    const inicio = new Date(input.fechaHoraInicio);
    const fin = new Date(input.fechaHoraFin);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || inicio >= fin) {
        throw new DisponibilidadError('El rango horario no es válido');
    }
    const recursoIds = [...new Set(input.recursoIds)];
    if (recursoIds.length === 0) {
        throw new DisponibilidadError('Debe seleccionar al menos un recurso');
    }
    const disponibilidad = await consultarDisponibilidad({
        fechaHoraInicio: input.fechaHoraInicio,
        fechaHoraFin: input.fechaHoraFin,
    });
    const seleccionados = disponibilidad.filter((recurso) => recursoIds.includes(recurso.id));
    if (seleccionados.length !== recursoIds.length) {
        throw new DisponibilidadError('Uno o más recursos no existen');
    }
    const noDisponibles = seleccionados.filter((recurso) => !recurso.disponible);
    if (noDisponibles.length > 0) {
        throw new DisponibilidadError(`Los recursos no están disponibles: ${noDisponibles.map((recurso) => recurso.nombre).join(', ')}`);
    }
    const fechaLimiteCheckIn = input.fechaLimiteCheckIn
        ? new Date(input.fechaLimiteCheckIn)
        : inicio;
    if (Number.isNaN(fechaLimiteCheckIn.getTime()) || fechaLimiteCheckIn > inicio) {
        throw new DisponibilidadError('La fecha límite de check-in no es válida');
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
        });
    });
}
