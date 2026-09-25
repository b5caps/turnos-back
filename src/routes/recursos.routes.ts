// src/routes/recursos.routes.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  consultarDisponibilidadNotebooks,
  consultarDisponibilidadSalas,
} from '../services/disponibilidad.service.js'

const recursos = new OpenAPIHono()

const querySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD requerido').openapi({
    example: '2026-09-05',
    description: 'Fecha a consultar (YYYY-MM-DD)',
  }),
})

const bloqueDisponibilidadSchema = z.object({
  horaInicio: z.string(),
  horaFin: z.string(),
  ocupacion: z.number(),
  disponible: z.boolean(),
  motivoNoDisponible: z.enum(['fuera_de_horario', 'bloqueado', 'sin_cupos']).nullable(),
})

const disponibilidadBaseSchema = z.object({
  id: z.number(),
  nombre: z.string(),
  capacidad: z.number(),
  horariosReservados: z.array(z.object({ horaInicio: z.string(), horaFin: z.string() })),
  bloques: z.array(bloqueDisponibilidadSchema),
})

const horarioEstablecimientoSchema = z.object({
  minutosApertura: z.number().int().openapi({ example: 480 }),
  minutosCierre: z.number().int().openapi({ example: 1320 }),
})

const salasResponseSchema = z.object({
  horarioEstablecimiento: horarioEstablecimientoSchema,
  recursos: z.array(disponibilidadBaseSchema.extend({
    ubicacion: z.string(),
  })),
})

const notebooksResponseSchema = z.object({
  horarioEstablecimiento: horarioEstablecimientoSchema,
  recursos: z.array(disponibilidadBaseSchema.extend({
    numeroSerie: z.string(),
    marca: z.string(),
    modelo: z.string(),
  })),
})

const disponibilidadSalasRoute = createRoute({
  method: 'get',
  path: '/disponibilidad/salas',
  tags: ['Recursos'],
  summary: 'Consultar disponibilidad de salas',
  request: { query: querySchema },
  responses: {
    200: { content: { 'application/json': { schema: salasResponseSchema } }, description: 'OK' },
    400: { description: 'Parámetros inválidos' },
  },
})

const disponibilidadNotebooksRoute = createRoute({
  method: 'get',
  path: '/disponibilidad/notebooks',
  tags: ['Recursos'],
  summary: 'Consultar disponibilidad de notebooks',
  request: { query: querySchema },
  responses: {
    200: { content: { 'application/json': { schema: notebooksResponseSchema } }, description: 'OK' },
    400: { description: 'Parámetros inválidos' },
  },
})

recursos.openapi(disponibilidadSalasRoute, async (c) => {
  const params = c.req.valid('query')
  const resultado = await consultarDisponibilidadSalas(params)
  return c.json(resultado)
})

recursos.openapi(disponibilidadNotebooksRoute, async (c) => {
  const params = c.req.valid('query')
  const resultado = await consultarDisponibilidadNotebooks(params)
  return c.json(resultado)
})

export default recursos