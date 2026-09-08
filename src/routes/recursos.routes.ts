// src/routes/recursos.routes.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { consultarDisponibilidad } from '../services/disponibilidad.service.js'

const recursos = new OpenAPIHono()

const querySchema = z.object({
  fechaHoraInicio: z.string().datetime({ offset: true, local: true }).openapi({
    example: '2026-09-05T14:00:00',
  }),
  fechaHoraFin: z.string().datetime({ offset: true, local: true }).openapi({
    example: '2026-09-05T16:00:00',
  }),
})

const responseSchema = z.object({
  data: z.array(
    z.object({
      id: z.number(),
      nombre: z.string(),
      tipo: z.enum(['SALA', 'NOTEBOOK']),
      capacidad: z.number(),
      ocupacion: z.number(),
      cuposLibres: z.number(),
      disponible: z.boolean(),
      motivoNoDisponible: z.enum(['fuera_de_horario', 'bloqueado', 'sin_cupos']).nullable(),
      horariosReservados: z.array(z.object({ horaInicio: z.string(), horaFin: z.string() })),
    })
  ),
})

const disponibilidadRoute = createRoute({
  method: 'get',
  path: '/disponibilidad',
  tags: ['Recursos'],
  summary: 'Consultar disponibilidad de espacios y recursos',
  request: { query: querySchema },
  responses: {
    200: { content: { 'application/json': { schema: responseSchema } }, description: 'OK' },
    400: { description: 'Parámetros inválidos' },
  },
})

recursos.openapi(disponibilidadRoute, async (c) => {
  const params = c.req.valid('query')
  const resultado = await consultarDisponibilidad(params)
  return c.json({ data: resultado })
})

export default recursos