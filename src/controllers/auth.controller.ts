import type { Context } from 'hono'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const onlyNumbersRegex = /^\d+$/
const saltRounds = 10

type RegisterBody = {
  nombre?: unknown
  correo?: unknown
  legajo?: unknown
  dni?: unknown
  password?: unknown
}

type LoginBody = {
  correo?: unknown
  password?: unknown
}

const normalizeString = (value: unknown) => {
  return typeof value === 'string' ? value.trim() : ''
}

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET

  if (!secret) {
    throw new Error('JWT_SECRET no esta configurado')
  }

  return secret
}

export const register = async (c: Context) => {
  try {
    const body = await c.req.json<RegisterBody>()
    const nombre = normalizeString(body.nombre)
    const correo = normalizeString(body.correo).toLowerCase()
    const legajo = normalizeString(body.legajo)
    const dni = normalizeString(body.dni)
    const password = normalizeString(body.password)

    if (!nombre || !correo || !legajo || !dni || !password) {
      return c.json({ message: 'Todos los campos son obligatorios' }, 400)
    }

    if (nombre.length < 2) {
      return c.json({ message: 'El nombre debe tener al menos 2 caracteres' }, 400)
    }

    if (!emailRegex.test(correo)) {
      return c.json({ message: 'El correo no tiene un formato valido' }, 400)
    }

    if (!onlyNumbersRegex.test(legajo)) {
      return c.json({ message: 'El legajo debe contener solo numeros' }, 400)
    }

    if (!onlyNumbersRegex.test(dni) || dni.length < 7 || dni.length > 8) {
      return c.json({ message: 'El dni debe contener 7 u 8 numeros' }, 400)
    }

    if (password.length < 8) {
      return c.json({ message: 'La contraseña debe tener al menos 8 caracteres' }, 400)
    }

    const existingUser = await prisma.usuario.findFirst({
      where: {
        OR: [{ correo }, { legajo }, { dni }]
      }
    })

    if (existingUser) {
      return c.json({ message: 'Ya existe un usuario con ese correo, legajo o dni' }, 409)
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds)
    const user = await prisma.usuario.create({
      data: {
        nombre,
        correo,
        legajo,
        dni,
        password: hashedPassword
      },
      select: {
        id: true,
        nombre: true,
        correo: true,
        legajo: true,
        dni: true,
        createdAt: true
      }
    })

    return c.json({ message: 'Usuario registrado correctamente', user }, 201)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return c.json({ message: 'El body debe ser un JSON valido' }, 400)
    }

    console.error(error)
    return c.json({ message: 'Error interno del servidor' }, 500)
  }
}

export const login = async (c: Context) => {
  try {
    const body = await c.req.json<LoginBody>()
    const correo = normalizeString(body.correo).toLowerCase()
    const password = normalizeString(body.password)

    if (!correo || !password) {
      return c.json({ message: 'Correo y contraseña son obligatorios' }, 400)
    }

    if (!emailRegex.test(correo)) {
      return c.json({ message: 'El correo no tiene un formato valido' }, 400)
    }

    const user = await prisma.usuario.findUnique({ where: { correo } })

    if (!user) {
      return c.json({ message: 'Credenciales invalidas' }, 401)
    }

    const passwordMatches = await bcrypt.compare(password, user.password)

    if (!passwordMatches) {
      return c.json({ message: 'Credenciales invalidas' }, 401)
    }

    const token = jwt.sign(
      { id: user.id, correo: user.correo, legajo: user.legajo },
      getJwtSecret(),
      { expiresIn: '14d' }
    )

    return c.json({
      message: 'Inicio de sesion correcto',
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        correo: user.correo,
        legajo: user.legajo,
        dni: user.dni
      }
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return c.json({ message: 'El body debe ser un JSON valido' }, 400)
    }

    console.error(error)
    return c.json({ message: 'Error interno del servidor' }, 500)
  }
}
