import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  crearReserva,
  DisponibilidadError,
} from "../services/disponibilidad.service.js";
import {
  cancelarReserva,
  ReservaBusinessError,
  ReservaConflictError,
  ReservaForbiddenError,
  ReservaNotFoundError,
} from "../services/reservas.service.js";
import {
  cancelarReservaBodySchema,
  cancelarReservaParamsSchema,
  cancelarReservaResponseSchema,
  errorSchema,
} from "../schemas/reservas.schema.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const reservas = new OpenAPIHono();

const reservaRequestSchema = z.object({
  usuarioId: z.number().int().positive(),
  recursoIds: z.array(z.number().int().positive()).min(1),
  fechaHoraInicio: z.string().datetime({ offset: true, local: true }),
  fechaHoraFin: z.string().datetime({ offset: true, local: true }),
  fechaLimiteCheckIn: z
    .string()
    .datetime({ offset: true, local: true })
    .optional(),
  observacion: z.string().optional(),
});

const reservaResponseSchema = z.object({
  id: z.number(),
  usuarioId: z.number(),
  fechaHoraInicio: z.string(),
  fechaHoraFin: z.string(),
  fechaLimiteCheckIn: z.string(),
  observacion: z.string().nullable(),
  recursos: z.array(
    z.object({
      recursoId: z.number(),
      recurso: z.object({
        id: z.number(),
        nombre: z.string(),
      }),
    }),
  ),
});

const crearReservaRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Reservas"],
  summary: "Reservar un espacio y sus recursos",
  request: {
    body: {
      content: {
        "application/json": { schema: reservaRequestSchema },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({ data: reservaResponseSchema }),
        },
      },
      description: "Reserva creada",
    },
    400: { description: "Solicitud inválida o recursos no disponibles" },
  },
});

reservas.openapi(crearReservaRoute, async (c) => {
  try {
    const reserva = await crearReserva(c.req.valid("json"));

    return c.json(
      {
        data: {
          ...reserva,
          fechaHoraInicio: reserva.fechaHoraInicio.toISOString(),
          fechaHoraFin: reserva.fechaHoraFin.toISOString(),
          fechaLimiteCheckIn: reserva.fechaLimiteCheckIn.toISOString(),
          recursos: reserva.recursos,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof DisponibilidadError) {
      return c.json({ message: error.message }, 400);
    }

    throw error;
  }
});

const cancelarReservaRoute = createRoute({
  method: "patch",
  path: "/{id}/cancelar",
  tags: ["Reservas"],
  summary: "Cancelar una reserva",
  description:
    "Cancela una reserva existente si el usuario es dueño de la misma o Administrador, siempre que no haya finalizado ni realizado check-in.",
  security: [{ Bearer: [] }],
  request: {
    params: cancelarReservaParamsSchema,
    body: {
      content: {
        "application/json": { schema: cancelarReservaBodySchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: cancelarReservaResponseSchema },
      },
      description: "Reserva cancelada exitosamente",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "Regla de negocio no cumplida (ej. ya finalizó o ya realizó check-in)",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado o token no provisto/inválido",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autorizado para cancelar esta reserva",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Reserva no encontrada",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "La reserva ya se encuentra cancelada",
    },
  },
});

reservas.use("/:id/cancelar", requireAuth);

reservas.openapi(cancelarReservaRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const usuarioAuth = c.get("usuario");

    const reserva = await cancelarReserva(id, body, usuarioAuth);

    return c.json(
      {
        data: {
          ...reserva,
          fechaHoraInicio: reserva.fechaHoraInicio.toISOString(),
          fechaHoraFin: reserva.fechaHoraFin.toISOString(),
          fechaLimiteCheckIn: reserva.fechaLimiteCheckIn.toISOString(),
          fechaHoraCancelacion:
            reserva.fechaHoraCancelacion?.toISOString() ?? null,
          recursos: reserva.recursos,
        },
      },
      200,
    );
  } catch (error) {
    if (error instanceof ReservaNotFoundError) {
      return c.json({ message: error.message }, 404);
    }
    if (error instanceof ReservaForbiddenError) {
      return c.json({ message: error.message }, 403);
    }
    if (error instanceof ReservaConflictError) {
      return c.json({ message: error.message }, 409);
    }
    if (error instanceof ReservaBusinessError) {
      return c.json({ message: error.message }, 400);
    }

    throw error;
  }
});

export default reservas;
