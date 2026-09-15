import type { Context } from 'hono'
import { prisma } from '../lib/prisma.js'

type NotebookBody = { codigo?: unknown; marca?: unknown; modelo?: unknown; activa?: unknown }
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const idFrom = (c: Context) => Number(c.req.param('id'))

function notebookData(body: NotebookBody) {
  const codigo = text(body.codigo)
  const marca = text(body.marca)
  const modelo = text(body.modelo)
  if (!codigo || !marca || !modelo) return null
  return { codigo, marca, modelo, activa: typeof body.activa === 'boolean' ? body.activa : true }
}

export async function listarNotebooks(c: Context) {
  return c.json(await prisma.notebook.findMany({ orderBy: { codigo: 'asc' } }))
}

export async function obtenerNotebook(c: Context) {
  const notebook = await prisma.notebook.findUnique({ where: { id: idFrom(c) } })
  return notebook ? c.json(notebook) : c.json({ message: 'Notebook no encontrada' }, 404)
}

export async function crearNotebook(c: Context) {
  try {
    const data = notebookData(await c.req.json<NotebookBody>())
    if (!data) return c.json({ message: 'Datos de notebook invalidos' }, 400)
    return c.json(await prisma.notebook.create({ data }), 201)
  } catch {
    return c.json({ message: 'El codigo ya existe o el body es invalido' }, 409)
  }
}

export async function actualizarNotebook(c: Context) {
  try {
    const data = notebookData(await c.req.json<NotebookBody>())
    if (!data) return c.json({ message: 'Datos de notebook invalidos' }, 400)
    return c.json(await prisma.notebook.update({ where: { id: idFrom(c) }, data }))
  } catch {
    return c.json({ message: 'Notebook no encontrada o codigo duplicado' }, 404)
  }
}
