import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  crearReserva,
  DisponibilidadError,
  DURACION_HOLD_MINUTOS,
} from "../services/disponibilidad.service.js";
import {
  cancelarReserva,
  confirmarReserva,
  finalizarReserva,

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
  errorSchema,
  finalizarReservaBodySchema,
  finalizarReservaParamsSchema,
  finalizarReservaResponseSchema,
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
  usuarioId: z.number().int().positive().optional().openapi({
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
        "Confirmar inmediatamente sin pasar por reserva pendiente (solo administradores)",
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
  esPendiente: z.boolean().optional(),
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
    "Crea una reserva de recursos. Los usuarios comunes inician una Reserva Pendiente (Hold de 10 min) que debe confirmarse. Los administradores pueden además reservar en nombre de otros usuarios o confirmar de forma inmediata.",
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
      description: "Reserva iniciada exitosamente (en reserva pendiente o confirmada)",
    },
    400: errorResponse("Solicitud inválida o recursos no disponibles"),
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
        confirmada: reserva.confirmada,
        esPendiente: reserva.esPendiente,
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

    const resultado = await crearReserva({
      ...body,
      usuarioId: titularId,
    });

    // Si es una Reserva confirmada inmediatamente por ADMIN:
    if ("fechaHoraInicio" in resultado) {
      return c.json(
        {
          data: {
            id: resultado.id,
            usuarioId: resultado.usuarioId,
            fechaHoraInicio: resultado.fechaHoraInicio.toISOString(),
            fechaHoraFin: resultado.fechaHoraFin.toISOString(),
            fechaLimiteCheckIn: resultado.fechaLimiteCheckIn.toISOString(),
            fechaHoraConfirmacion:
              resultado.fechaHoraConfirmacion?.toISOString() ?? null,
            fechaExpiracionHold: null,
            confirmada: true,
            esPendiente: false,
            observacion: resultado.observacion ?? null,
            recursos: resultado.recursos,
          },
        },
        201,
      );
    }

    // Si es una ReservaPendiente (Hold temporal de 10 minutos):
    const expiracionHold = new Date(
      resultado.fechaHoraSolicitud.getTime() + DURACION_HOLD_MINUTOS * 60 * 1000,
    );
    return c.json(
      {
        data: {
          id: resultado.id,
          usuarioId: resultado.usuarioId,
          fechaHoraInicio: resultado.fechaHoraDeseadaInicio.toISOString(),
          fechaHoraFin: resultado.fechaHoraDeseadaFin.toISOString(),
          fechaLimiteCheckIn: resultado.fechaHoraDeseadaInicio.toISOString(),
          fechaHoraConfirmacion: null,
          fechaExpiracionHold: expiracionHold.toISOString(),
          confirmada: false,
          esPendiente: true,
          observacion: body.observacion ?? null,
          recursos: resultado.recursos,
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
  summary: "Confirmar una reserva pendiente (Hold)",
  description:
    "Confirma una reserva pendiente en hold convirtiéndola en reserva definitiva. Debe realizarse dentro de los 10 minutos de la solicitud.",
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
    403: errorResponse("No tienes permisos para confirmar esta reserva pendiente"),
    404: errorResponse("Reserva pendiente no encontrada"),
    409: errorResponse("El tiempo para confirmar ha expirado o el recurso no está disponible"),
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
          fechaExpiracionHold: null,
          confirmada: true,
          esPendiente: false,
          fechaHoraCancelacion:
            reserva.fechaHoraCancelacion?.toISOString() ?? null,
          fechaHoraCheckIn: reserva.fechaHoraCheckIn?.toISOString() ?? null,
          fechaHoraCheckOut: reserva.fechaHoraCheckOut?.toISOString() ?? null,
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

const finalizarReservaRoute = createRoute({
  method: "patch",
  path: "/{id}/finalizar",
  tags: ["Reservas"],
  summary: "Finalizar una reserva en curso",
  description:
    "Finaliza una reserva activa que se encuentre en curso y con check-in realizado. Puede ser ejecutado por el titular de la reserva o por un Administrador, liberando de inmediato el recurso.",
  security: [{ Bearer: [] }],
  request: {
    params: finalizarReservaParamsSchema,
    body: {
      content: {
        "application/json": { schema: finalizarReservaBodySchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: finalizarReservaResponseSchema },
      },
      description: "Reserva finalizada exitosamente",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "Regla de negocio no cumplida (ej. no está en curso o no tiene check-in)",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado o token no provisto/inválido",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autorizado para finalizar esta reserva",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Reserva no encontrada",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "La reserva ya se encuentra cancelada o finalizada",
    },
  },
});

reservas.openapi(finalizarReservaRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const usuarioAuth = c.get("usuario");

    const reserva = await finalizarReserva(id, body, usuarioAuth);

    return c.json(
      {
        data: {
          ...reserva,
          fechaHoraInicio: reserva.fechaHoraInicio.toISOString(),
          fechaHoraFin: reserva.fechaHoraFin.toISOString(),
          fechaLimiteCheckIn: reserva.fechaLimiteCheckIn.toISOString(),
          fechaHoraCancelacion:
            reserva.fechaHoraCancelacion?.toISOString() ?? null,
          fechaHoraCheckIn: reserva.fechaHoraCheckIn?.toISOString() ?? null,
          fechaHoraCheckOut: reserva.fechaHoraCheckOut?.toISOString() ?? null,
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
