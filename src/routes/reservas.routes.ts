import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  crearReserva,
  DisponibilidadError,
} from "../services/disponibilidad.service.js";
import {
  cancelarReserva,
  confirmarReserva,
  listarReservas,
  resolverTitularReserva,
  ReservaBusinessError,
  ReservaConflictError,
  ReservaForbiddenError,
  ReservaNotFoundError,
} from "../services/reservas.service.js";
import {
  cancelarReservaBodySchema,
  cancelarReservaParamsSchema,
  cancelarReservaResponseSchema,
  confirmarReservaParamsSchema,
  confirmarReservaResponseSchema,
  errorResponse,
  listarReservasQuerySchema,
  listarReservasResponseSchema,
  unauthorizedResponse,
} from "../schemas/reservas.schema.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const reservas = new OpenAPIHono();

const listarReservasRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Reservas"],
  summary: "Listar reservas",
  description:
    "Lista las reservas del usuario autenticado. Los administradores pueden ver todas las reservas y filtrar por usuarioId.",
  security: [{ Bearer: [] }],
  request: {
    query: listarReservasQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: listarReservasResponseSchema,
        },
      },
      description: "Lista de reservas obtenida exitosamente",
    },
    401: unauthorizedResponse,
  },
});

const reservaRequestSchema = z.object({
  usuarioId: z
    .number()
    .int()
    .positive()
    .optional()
    .openapi({
      description:
        "ID del usuario (opcional; administradores pueden especificarlo para reservar en su nombre)",
    }),
  recursoIds: z.array(z.number().int().positive()).min(1),
  fechaHoraInicio: z.string().datetime({ offset: true, local: true }),
  fechaHoraFin: z.string().datetime({ offset: true, local: true }),
  fechaLimiteCheckIn: z
    .string()
    .datetime({ offset: true, local: true })
    .optional(),
  observacion: z.string().optional(),
  confirmarInmediato: z
    .boolean()
    .optional()
    .openapi({
      description:
        "Confirmar inmediatamente la reserva sin hold temporal (solo administradores)",
    }),
});

const reservaResponseSchema = z.object({
  id: z.number(),
  usuarioId: z.number(),
  fechaHoraInicio: z.string(),
  fechaHoraFin: z.string(),
  fechaLimiteCheckIn: z.string(),
  fechaHoraConfirmacion: z.string().nullable().optional(),
  fechaExpiracionHold: z.string().nullable().optional(),
  confirmada: z.boolean().optional(),
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
  description:
    "Crea una reserva de recursos. Para usuarios comunes inicia en estado de reserva temporal (Hold de 10 min) y requiere confirmación posterior. Los administradores pueden además reservar en nombre de otros usuarios o confirmar de forma inmediata.",
  security: [{ Bearer: [] }],
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
      description: "Reserva iniciada exitosamente (en hold o confirmada)",
    },
    400: errorResponse("Solicitud inválida o rango horario no disponible"),
    401: unauthorizedResponse,
    403: errorResponse("No autorizado para reservar en nombre de otro usuario o confirmar de inmediato"),
    404: errorResponse("El usuario especificado no existe"),
    409: errorResponse("Uno o más recursos ya se encuentran reservados o bloqueados en ese horario"),
  },
});

reservas.use("*", requireAuth);

reservas.openapi(listarReservasRoute, async (c) => {
  const usuarioAuth = c.get("usuario");
  const query = c.req.valid("query");

  const lista = await listarReservas(query, usuarioAuth);

  return c.json(
    {
      data: lista.map((reserva) => ({
        ...reserva,
        fechaHoraInicio: reserva.fechaHoraInicio.toISOString(),
        fechaHoraFin: reserva.fechaHoraFin.toISOString(),
        fechaLimiteCheckIn: reserva.fechaLimiteCheckIn.toISOString(),
        fechaHoraConfirmacion:
          reserva.fechaHoraConfirmacion?.toISOString() ?? null,
        fechaExpiracionHold:
          reserva.fechaExpiracionHold?.toISOString() ?? null,
        confirmada: reserva.fechaHoraConfirmacion !== null,
        fechaHoraCancelacion:
          reserva.fechaHoraCancelacion?.toISOString() ?? null,
        fechaHoraCheckIn: reserva.fechaHoraCheckIn?.toISOString() ?? null,
        fechaHoraCheckOut: reserva.fechaHoraCheckOut?.toISOString() ?? null,
        recursos: reserva.recursos,
      })),
    },
    200,
  );
});

reservas.openapi(crearReservaRoute, async (c) => {
  try {
    const usuarioAuth = c.get("usuario");
    const body = c.req.valid("json");

    if (body.confirmarInmediato && usuarioAuth.rol !== "ADMIN") {
      return c.json(
        { message: "Solo los administradores pueden confirmar inmediatamente una reserva al crearla" },
        403,
      );
    }

    const titularId = await resolverTitularReserva(body.usuarioId, usuarioAuth);

    const reserva = await crearReserva({
      ...body,
      usuarioId: titularId,
    });

    return c.json(
      {
        data: {
          ...reserva,
          fechaHoraInicio: reserva.fechaHoraInicio.toISOString(),
          fechaHoraFin: reserva.fechaHoraFin.toISOString(),
          fechaLimiteCheckIn: reserva.fechaLimiteCheckIn.toISOString(),
          fechaHoraConfirmacion:
            reserva.fechaHoraConfirmacion?.toISOString() ?? null,
          fechaExpiracionHold:
            reserva.fechaExpiracionHold?.toISOString() ?? null,
          confirmada: reserva.fechaHoraConfirmacion !== null,
          recursos: reserva.recursos,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof ReservaForbiddenError) {
      return c.json({ message: error.message }, 403);
    }
    if (error instanceof ReservaNotFoundError) {
      return c.json({ message: error.message }, 404);
    }
    if (error instanceof ReservaConflictError) {
      return c.json({ message: error.message }, 409);
    }
    if (error instanceof DisponibilidadError) {
      return c.json({ message: error.message }, 400);
    }

    throw error;
  }
});

const confirmarReservaRoute = createRoute({
  method: "post",
  path: "/{id}/confirmar",
  tags: ["Reservas"],
  summary: "Confirmar una reserva temporal en hold",
  description:
    "Confirma una reserva temporalmente apartada (hold de 10 min) antes de que expire su tiempo límite.",
  security: [{ Bearer: [] }],
  request: {
    params: confirmarReservaParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: confirmarReservaResponseSchema },
      },
      description: "Reserva confirmada exitosamente",
    },
    401: unauthorizedResponse,
    403: errorResponse("No tienes permisos para confirmar esta reserva"),
    404: errorResponse("Reserva no encontrada"),
    409: errorResponse("La reserva ya fue confirmada, está cancelada o su tiempo de hold expiró"),
  },
});

reservas.openapi(confirmarReservaRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const usuarioAuth = c.get("usuario");

    const reserva = await confirmarReserva(id, usuarioAuth);

    return c.json(
      {
        data: {
          ...reserva,
          fechaHoraInicio: reserva.fechaHoraInicio.toISOString(),
          fechaHoraFin: reserva.fechaHoraFin.toISOString(),
          fechaLimiteCheckIn: reserva.fechaLimiteCheckIn.toISOString(),
          fechaHoraConfirmacion:
            reserva.fechaHoraConfirmacion?.toISOString() ?? null,
          fechaExpiracionHold:
            reserva.fechaExpiracionHold?.toISOString() ?? null,
          confirmada: true,
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
    400: errorResponse(
      "Regla de negocio no cumplida (ej. ya finalizó o ya realizó check-in)",
    ),
    401: unauthorizedResponse,
    403: errorResponse("No autorizado para cancelar esta reserva"),
    404: errorResponse("Reserva no encontrada"),
    409: errorResponse("La reserva ya se encuentra cancelada"),
  },
});

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
          fechaHoraConfirmacion:
            reserva.fechaHoraConfirmacion?.toISOString() ?? null,
          fechaExpiracionHold:
            reserva.fechaExpiracionHold?.toISOString() ?? null,
          confirmada: reserva.fechaHoraConfirmacion !== null,
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
