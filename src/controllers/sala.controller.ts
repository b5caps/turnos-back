import type { Context } from 'hono'
import { prisma } from '../lib/prisma.js'

type SalaBody = { nombre?: unknown; descripcion?: unknown; ubicacion?: unknown; capacidad?: unknown; activa?: unknown }
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const idFrom = (c: Context) => Number(c.req.param('id'))

function salaData(body: SalaBody) {
  const nombre = text(body.nombre)
  const ubicacion = text(body.ubicacion)
  const capacidad = Number(body.capacidad)
  if (!nombre || !ubicacion || !Number.isInteger(capacidad) || capacidad < 1) return null

  return {
    nombre,
    ubicacion,
    capacidad,
    descripcion: text(body.descripcion) || null,
    activa: typeof body.activa === 'boolean' ? body.activa : true,
  }
}

export async function listarSalas(c: Context) {
  return c.json(await prisma.sala.findMany({ orderBy: { nombre: 'asc' } }))
}

export async function obtenerSala(c: Context) {
  const sala = await prisma.sala.findUnique({ where: { id: idFrom(c) } })
  return sala ? c.json(sala) : c.json({ message: 'Sala no encontrada' }, 404)
}

export async function crearSala(c: Context) {
  try {
    const data = salaData(await c.req.json<SalaBody>())
    if (!data) return c.json({ message: 'Datos de sala invalidos' }, 400)
    return c.json(await prisma.sala.create({ data }), 201)
  } catch {
    return c.json({ message: 'El body debe ser un JSON valido' }, 400)
  }
}

export async function actualizarSala(c: Context) {
  try {
    const data = salaData(await c.req.json<SalaBody>())
    if (!data) return c.json({ message: 'Datos de sala invalidos' }, 400)
    return c.json(await prisma.sala.update({ where: { id: idFrom(c) }, data }))
  } catch {
    return c.json({ message: 'Sala no encontrada' }, 404)
  }
}
