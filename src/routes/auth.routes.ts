import { Prisma } from '@prisma/client'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { iniciarSesion, registrar } from '../services/auth.service.js'

const auth = new OpenAPIHono()

const datosComunes = {
  tipoDocumento: z.enum(['DNI', 'CUIL']),
  documento: z.string().trim().min(1),
  nombre: z.string().trim().min(1),
  apellido: z.string().trim().min(1),
  email: z.email().trim(),
  telefono: z.string().trim().min(1),
  password: z.string().min(8).refine(value => Buffer.byteLength(value, 'utf8') <= 72, {
    message: 'La contraseña no puede superar 72 bytes',
  }),
}

const registroSchema = z.discriminatedUnion('rol', [
  z.object({
    ...datosComunes,
    rol: z.literal('UTN'),
    legajo: z.string().trim().min(1),
    docente: z.boolean(),
    carrera: z.string().trim().min(1).optional(),
  }).strict(),
  z.object({
    ...datosComunes,
    rol: z.literal('EXTERNO'),
    localidad: z.string().trim().min(1),
    provincia: z.string().trim().min(1),
    organizacion: z.string().trim().min(1),
  }).strict(),
])

const loginSchema = z.object({
  email: z.email().trim(),
  password: z.string().min(1),
}).strict()

const sesionSchema = z.object({
  usuario: z.object({
    id: z.number(),
    rol: z.enum(['UTN', 'EXTERNO', 'ADMIN']),
    nombre: z.string(),
    apellido: z.string(),
    email: z.string(),
  }),
  token: z.string(),
  expiresIn: z.number(),
})

const errorSchema = z.object({ message: z.string() })

const registroRoute = createRoute({
  method: 'post',
  path: '/registro',
  tags: ['Autenticación'],
  summary: 'Registrar usuario UTN o externo',
  request: { body: { content: { 'application/json': { schema: registroSchema } } } },
  responses: {
    201: { description: 'Usuario registrado', content: { 'application/json': { schema: sesionSchema } } },
    400: { description: 'Datos inválidos', content: { 'application/json': { schema: errorSchema } } },
    409: { description: 'Email, documento o legajo ya registrado', content: { 'application/json': { schema: errorSchema } } },
  },
})

const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Autenticación'],
  summary: 'Iniciar sesión con email y contraseña',
  request: { body: { content: { 'application/json': { schema: loginSchema } } } },
  responses: {
    200: { description: 'Sesión iniciada', content: { 'application/json': { schema: sesionSchema } } },
    400: { description: 'Datos inválidos', content: { 'application/json': { schema: errorSchema } } },
    401: { description: 'Credenciales inválidas', content: { 'application/json': { schema: errorSchema } } },
  },
})

auth.openapi(registroRoute, async (c) => {
  try {
    return c.json(await registrar(c.req.valid('json')), 201)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return c.json({ message: 'Email, documento o legajo ya registrado' }, 409)
    }
    throw error
  }
})

auth.openapi(loginRoute, async (c) => {
  const sesion = await iniciarSesion(c.req.valid('json').email, c.req.valid('json').password)
  if (!sesion) return c.json({ message: 'Credenciales inválidas' }, 401)
  return c.json(sesion, 200)
})

export default auth
