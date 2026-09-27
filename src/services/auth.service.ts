import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import type { Rol, TipoDocumento } from '@prisma/client'

const prisma = new PrismaClient()
const SALT_ROUNDS = 12

type DatosComunes = {
  tipoDocumento: TipoDocumento
  documento: string
  nombre: string
  apellido: string
  email: string
  telefono: string
  password: string
}

export type RegistroInput = DatosComunes & (
  | { rol: 'UTN'; legajo: string; docente: boolean; carrera?: string }
  | { rol: 'EXTERNO'; localidad: string; provincia: string; organizacion: string }
)

function datosPublicos(usuario: { id: number; rol: Rol; nombre: string; apellido: string; email: string }) {
  return {
    id: usuario.id,
    rol: usuario.rol,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    email: usuario.email,
  }
}

function configuracionJwt() {
  const secreto = process.env.JWT_SECRET
  if (!secreto) throw new Error('JWT_SECRET no está configurado')

  const expiresIn = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 86400)
  if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
    throw new Error('JWT_EXPIRES_IN_SECONDS debe ser un número entero positivo')
  }

  return { secreto, expiresIn }
}

function crearToken(usuario: { id: number; rol: Rol }, config = configuracionJwt()) {
  return {
    token: jwt.sign({ rol: usuario.rol }, config.secreto, { subject: String(usuario.id), expiresIn: config.expiresIn }),
    expiresIn: config.expiresIn,
  }
}

export async function registrar(input: RegistroInput) {
  // Verificar la configuración antes de crear la cuenta, para no dejar registros sin respuesta utilizable.
  const jwtConfig = configuracionJwt()
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS)
  const usuario = await prisma.usuario.create({
    data: {
      tipoDocumento: input.tipoDocumento,
      documento: input.documento.trim(),
      nombre: input.nombre.trim(),
      apellido: input.apellido.trim(),
      email: input.email.trim().toLowerCase(),
      telefono: input.telefono.trim(),
      rol: input.rol,
      passwordHash,
      ...(input.rol === 'UTN'
        ? { perfilUTN: { create: {
          legajo: input.legajo.trim(),
          docente: input.docente,
          carrera: input.carrera?.trim(),
        } } }
        : { perfilExterno: { create: {
          localidad: input.localidad.trim(),
          provincia: input.provincia.trim(),
          organizacion: input.organizacion.trim(),
        } } }),
    },
  })

  return { usuario: datosPublicos(usuario), ...crearToken(usuario, jwtConfig) }
}

export async function iniciarSesion(email: string, password: string) {
  const usuario = await prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } })
  if (!usuario?.passwordHash || !(await bcrypt.compare(password, usuario.passwordHash))) {
    return null
  }

  return { usuario: datosPublicos(usuario), ...crearToken(usuario) }
}
