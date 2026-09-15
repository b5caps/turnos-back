import { EstadoReserva, TipoNotificacion } from '@prisma/client'
import type { Context } from 'hono'
import { prisma } from '../lib/prisma.js'

type ReservaBody = {
  usuarioId?: unknown
  salaId?: unknown
  notebookId?: unknown
  creadaPorId?: unknown
  cantidadPersonas?: unknown
  fechaHoraInicio?: unknown
  fechaHoraFin?: unknown
  fechaLimiteCheckIn?: unknown
  observacion?: unknown
  motivoCancelacion?: unknown
}
const idFrom = (c: Context) => Number(c.req.param('id'))
const number = (value: unknown) => Number(value)
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export async function listarReservas(c: Context) {
  return c.json(await prisma.reserva.findMany({
    include: { usuario: { select: { id: true, nombre: true, apellido: true } }, sala: true, notebook: true },
    orderBy: { fechaHoraInicio: 'asc' },
  }))
}

export async function obtenerReserva(c: Context) {
  const reserva = await prisma.reserva.findUnique({
    where: { id: idFrom(c) },
    include: { usuario: true, sala: true, notebook: true, notificaciones: true },
  })
  return reserva ? c.json(reserva) : c.json({ message: 'Reserva no encontrada' }, 404)
}

export async function crearReserva(c: Context) {
  try {
    const body = await c.req.json<ReservaBody>()
    const usuarioId = number(body.usuarioId)
    const salaId = number(body.salaId)
    const notebookId = body.notebookId === undefined ? null : number(body.notebookId)
    const cantidadPersonas = number(body.cantidadPersonas)
    const inicio = new Date(text(body.fechaHoraInicio))
    const fin = new Date(text(body.fechaHoraFin))
    const limite = new Date(text(body.fechaLimiteCheckIn))

    if (![usuarioId, salaId, cantidadPersonas].every(Number.isInteger) || cantidadPersonas < 1 || inicio >= fin || limite > inicio) {
      return c.json({ message: 'Datos de reserva invalidos' }, 400)
    }

    const [usuario, sala, notebook] = await Promise.all([
      prisma.usuario.findUnique({ where: { id: usuarioId } }),
      prisma.sala.findUnique({ where: { id: salaId } }),
      notebookId ? prisma.notebook.findUnique({ where: { id: notebookId } }) : null,
    ])

    if (!usuario || !sala || !sala.activa || (notebookId && (!notebook || !notebook.activa))) {
      return c.json({ message: 'Usuario, sala o notebook no disponible' }, 400)
    }
    if (cantidadPersonas > sala.capacidad) return c.json({ message: 'La capacidad de la sala fue superada' }, 400)

    const activeStates = [EstadoReserva.CONFIRMADA, EstadoReserva.EN_CURSO]
    const conflict = await prisma.reserva.findFirst({
      where: {
        estado: { in: activeStates },
        fechaHoraInicio: { lt: fin },
        fechaHoraFin: { gt: inicio },
        OR: [{ salaId }, ...(notebookId ? [{ notebookId }] : [])],
      },
    })
    if (conflict) return c.json({ message: 'La sala o notebook ya esta reservada en ese horario' }, 409)

    const reserva = await prisma.reserva.create({
      data: {
        usuarioId,
        salaId,
        notebookId,
        creadaPorId: Number.isInteger(number(body.creadaPorId)) ? number(body.creadaPorId) : usuarioId,
        cantidadPersonas,
        fechaHoraInicio: inicio,
        fechaHoraFin: fin,
        fechaLimiteCheckIn: limite,
        observacion: text(body.observacion) || null,
      },
      include: { sala: true, notebook: true },
    })
    await prisma.notificacion.create({
      data: { usuarioId, reservaId: reserva.id, tipo: TipoNotificacion.RESERVA_CREADA, mensaje: `Reserva confirmada para ${reserva.sala.nombre}` },
    })
    return c.json(reserva, 201)
  } catch {
    return c.json({ message: 'El body debe ser un JSON valido' }, 400)
  }
}

export async function cancelarReserva(c: Context) {
  try {
    const body = await c.req.json<ReservaBody>()
    const reserva = await prisma.reserva.update({
      where: { id: idFrom(c) },
      data: { estado: EstadoReserva.CANCELADA, fechaHoraCancelacion: new Date(), motivoCancelacion: text(body.motivoCancelacion) || null },
    })
    await prisma.notificacion.create({
      data: { usuarioId: reserva.usuarioId, reservaId: reserva.id, tipo: TipoNotificacion.RESERVA_CANCELADA, mensaje: 'Tu reserva fue cancelada' },
    })
    return c.json(reserva)
  } catch {
    return c.json({ message: 'Reserva no encontrada' }, 404)
  }
}

export async function registrarCheckIn(c: Context) {
  try {
    return c.json(await prisma.reserva.update({ where: { id: idFrom(c) }, data: { estado: EstadoReserva.EN_CURSO, fechaHoraCheckIn: new Date() } }))
  } catch {
    return c.json({ message: 'Reserva no encontrada' }, 404)
  }
}

export async function registrarCheckOut(c: Context) {
  try {
    return c.json(await prisma.reserva.update({ where: { id: idFrom(c) }, data: { estado: EstadoReserva.FINALIZADA, fechaHoraCheckOut: new Date() } }))
  } catch {
    return c.json({ message: 'Reserva no encontrada' }, 404)
  }
}
