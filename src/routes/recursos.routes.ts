// src/routes/recursos.routes.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  consultarDisponibilidadNotebooks,
  consultarDisponibilidadSalas,
} from '../services/disponibilidad.service.js'

const recursos = new OpenAPIHono()

const querySchema = z.object({
  fechaHoraInicio: z.string().datetime({ offset: true, local: true }).openapi({
    example: '2026-09-05T14:00:00',
  }),
  fechaHoraFin: z.string().datetime({ offset: true, local: true }).openapi({
    example: '2026-09-05T16:00:00',
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
  disponible: z.boolean(),
  motivoNoDisponible: z.enum(['fuera_de_horario', 'bloqueado', 'sin_cupos']).nullable(),
  horariosReservados: z.array(z.object({ horaInicio: z.string(), horaFin: z.string() })),
  bloques: z.array(bloqueDisponibilidadSchema),
})

const horarioEstablecimientoSchema = z.object({
  horaApertura: z.string(),
  horaCierre: z.string(),
})

const salasResponseSchema = z.object({
  horarioEstablecimiento: horarioEstablecimientoSchema,
  data: z.array(disponibilidadBaseSchema.extend({
    ubicacion: z.string(),
  })),
})

const notebooksResponseSchema = z.object({
  horarioEstablecimiento: horarioEstablecimientoSchema,
  data: z.array(disponibilidadBaseSchema.extend({
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