import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  crearReserva,
  DisponibilidadError,
} from "../services/disponibilidad.service.js";
import {
  cancelarReserva,
  listarReservas,
  resolverTitularReserva,
  ReservaBusinessError,
  ReservaConflictError,
  ReservaForbiddenError,
  ReservaNotFoundError,
  UsuarioNotFoundError,
} from "../services/reservas.service.js";
import {
  cancelarReservaBodySchema,
  cancelarReservaParamsSchema,
  cancelarReservaResponseSchema,
  crearReservaBodySchema,
  errorSchema,
  listarReservasQuerySchema,
  listarReservasResponseSchema,
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
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado o token no provisto/inválido",
    },
  },
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
  description:
    "Crea una reserva para el usuario autenticado o, si es Administrador, en nombre del usuario especificado.",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: crearReservaBodySchema },
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
      description: "Reserva creada exitosamente",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Solicitud inválida o recursos no disponibles",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado o token no provisto/inválido",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "No autorizado para crear reservas en nombre de otro usuario",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "El usuario objetivo especificado no existe",
    },
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

    if (body.usuarioId !== undefined && body.usuarioId !== usuarioAuth.id) {
      if (usuarioAuth.rol !== "ADMIN") {
        return c.json(
          {
            message:
              "No tienes permisos para crear reservas en nombre de otro usuario",
          },
          403,
        );
      }
    }

    const targetUsuarioId =
      usuarioAuth.rol === "ADMIN" && body.usuarioId
        ? body.usuarioId
        : usuarioAuth.id;

    let observacion = body.observacion;
    if (usuarioAuth.rol === "ADMIN" && targetUsuarioId !== usuarioAuth.id) {
      const prefijo = "[Gestionado por Administrador]";
      observacion = observacion ? `${prefijo} ${observacion}` : prefijo;
    }

    const reserva = await crearReserva({
      ...body,
      usuarioId: targetUsuarioId,
      observacion,
    });

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
    if (error instanceof UsuarioNotFoundError) {
      return c.json({ message: error.message }, 404);
    }
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
