import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  crearReserva,
  DisponibilidadError,
} from '../services/disponibilidad.service.js'

const reservas = new OpenAPIHono()

const reservaRequestSchema = z.object({
  usuarioId: z.number().int().positive(),
  recursoIds: z.array(z.number().int().positive()).min(1),
  fechaHoraInicio: z.string().datetime({ offset: true, local: true }),
  fechaHoraFin: z.string().datetime({ offset: true, local: true }),
  fechaLimiteCheckIn: z.string().datetime({ offset: true, local: true }).optional(),
  observacion: z.string().optional(),
})

const reservaResponseSchema = z.object({
  id: z.number(),
  usuarioId: z.number(),
  fechaHoraInicio: z.string(),
  fechaHoraFin: z.string(),
  fechaLimiteCheckIn: z.string(),
  observacion: z.string().nullable(),
  recursos: z.array(z.object({
    recursoId: z.number(),
    recurso: z.object({
      id: z.number(),
      nombre: z.string(),
    }),
  })),
})

const crearReservaRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Reservas'],
  summary: 'Reservar un espacio y sus recursos',
  request: {
    body: {
      content: {
        'application/json': { schema: reservaRequestSchema },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: z.object({ data: reservaResponseSchema }) } },
      description: 'Reserva creada',
    },
    400: { description: 'Solicitud inválida o recursos no disponibles' },
  },
})

reservas.openapi(crearReservaRoute, async (c) => {
  try {
    const reserva = await crearReserva(c.req.valid('json'))

    return c.json({
      data: {
        ...reserva,
        fechaHoraInicio: reserva.fechaHoraInicio.toISOString(),
        fechaHoraFin: reserva.fechaHoraFin.toISOString(),
        fechaLimiteCheckIn: reserva.fechaLimiteCheckIn.toISOString(),
        recursos: reserva.recursos,
      },
    }, 201)
  } catch (error) {
    if (error instanceof DisponibilidadError) {
      return c.json({ message: error.message }, 400)
    }

    throw error
  }
})

export default reservas