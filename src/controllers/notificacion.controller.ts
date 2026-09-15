import type { Context } from 'hono'
import { prisma } from '../lib/prisma.js'

const idFrom = (c: Context) => Number(c.req.param('id'))

export async function listarNotificaciones(c: Context) {
  const usuarioId = Number(c.req.query('usuarioId'))
  if (!Number.isInteger(usuarioId)) return c.json({ message: 'usuarioId es obligatorio' }, 400)
  return c.json(await prisma.notificacion.findMany({ where: { usuarioId }, orderBy: { creadoEn: 'desc' } }))
}

export async function marcarComoLeida(c: Context) {
  try {
    return c.json(await prisma.notificacion.update({ where: { id: idFrom(c) }, data: { leidaEn: new Date() } }))
  } catch {
    return c.json({ message: 'Notificacion no encontrada' }, 404)
  }
}
