import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Rol } from '@prisma/client'
import type { Context } from 'hono'
import { prisma } from '../lib/prisma.js'

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const userSelect = {
  id: true,
  nombre: true,
  apellido: true,
  email: true,
  documento: true,
  telefono: true,
  rol: true,
  legajo: true,
  carrera: true,
  esDocente: true,
  organizacion: true,
  localidad: true,
  provincia: true,
  creadoEn: true,
  actualizadoEn: true,
} as const

type UsuarioBody = {
  nombre?: unknown
  apellido?: unknown
  email?: unknown
  documento?: unknown
  telefono?: unknown
  password?: unknown
  rol?: unknown
  legajo?: unknown
  carrera?: unknown
  esDocente?: unknown
  organizacion?: unknown
  localidad?: unknown
  provincia?: unknown
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const optionalText = (value: unknown) => {
  const normalized = text(value)
  return normalized || null
}
const idFrom = (c: Context) => Number(c.req.param('id'))

function getRole(value: unknown, legajo: string | null) {
  if (value === Rol.ADMIN || value === Rol.UTN || value === Rol.EXTERNO) return value
  return legajo ? Rol.UTN : Rol.EXTERNO
}

function jwtSecret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET no esta configurado')
  return process.env.JWT_SECRET
}

function usuarioData(body: UsuarioBody) {
  const nombre = text(body.nombre)
  const apellido = text(body.apellido)
  const email = text(body.email).toLowerCase()
  const documento = text(body.documento)
  const legajo = optionalText(body.legajo)

  if (!nombre || !apellido || !email || !documento) return null
  if (!emailRegex.test(email)) return null

  return {
    nombre,
    apellido,
    email,
    documento,
    telefono: optionalText(body.telefono),
    rol: getRole(body.rol, legajo),
    legajo,
    carrera: optionalText(body.carrera),
    esDocente: typeof body.esDocente === 'boolean' ? body.esDocente : null,
    organizacion: optionalText(body.organizacion),
    localidad: optionalText(body.localidad),
    provincia: optionalText(body.provincia),
  }
}

export async function listarUsuarios(c: Context) {
  return c.json(await prisma.usuario.findMany({ select: userSelect, orderBy: { nombre: 'asc' } }))
}

export async function obtenerUsuario(c: Context) {
  const usuario = await prisma.usuario.findUnique({ where: { id: idFrom(c) }, select: userSelect })
  return usuario ? c.json(usuario) : c.json({ message: 'Usuario no encontrado' }, 404)
}

export async function crearUsuario(c: Context) {
  try {
    const body = await c.req.json<UsuarioBody>()
    const data = usuarioData(body)
    const password = text(body.password)

    if (!data || password.length < 8) {
      return c.json({ message: 'Datos de usuario invalidos' }, 400)
    }

    const usuario = await prisma.usuario.create({
      data: { ...data, passwordHash: await bcrypt.hash(password, 10) },
      select: userSelect,
    })
    return c.json(usuario, 201)
  } catch (error) {
    if (error instanceof SyntaxError) return c.json({ message: 'El body debe ser un JSON valido' }, 400)
    return c.json({ message: 'El email, documento o legajo ya existe' }, 409)
  }
}

export async function iniciarSesion(c: Context) {
  try {
    const body = await c.req.json<UsuarioBody>()
    const email = text(body.email).toLowerCase()
    const password = text(body.password)
    const usuario = await prisma.usuario.findUnique({ where: { email } })

    if (!usuario || !await bcrypt.compare(password, usuario.passwordHash)) {
      return c.json({ message: 'Credenciales invalidas' }, 401)
    }

    const token = jwt.sign({ id: usuario.id, rol: usuario.rol }, jwtSecret(), { expiresIn: '14d' })
    const { passwordHash: _, ...user } = usuario
    return c.json({ token, user })
  } catch (error) {
    if (error instanceof SyntaxError) return c.json({ message: 'El body debe ser un JSON valido' }, 400)
    return c.json({ message: 'No se pudo iniciar sesion' }, 500)
  }
}

export async function actualizarUsuario(c: Context) {
  try {
    const body = await c.req.json<UsuarioBody>()
    const data = usuarioData(body)
    const password = text(body.password)
    if (!data) return c.json({ message: 'Datos de usuario invalidos' }, 400)

    const usuario = await prisma.usuario.update({
      where: { id: idFrom(c) },
      data: {
        ...data,
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      },
      select: userSelect,
    })
    return c.json(usuario)
  } catch {
    return c.json({ message: 'Usuario no encontrado o datos duplicados' }, 404)
  }
}
