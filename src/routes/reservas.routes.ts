import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  crearReserva,
  DisponibilidadError,
} from "../services/disponibilidad.service.js";
import {
  cancelarReserva,
  editarReserva,
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
  crearReservaSchema,
  editarReservaSchema,
  errorSchema,
  listarReservasQuerySchema,
  listarReservasResponseSchema,
  reservaParamsSchema,
  reservaResponseSchema,
} from "../schemas/reservas.schema.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const reservas = new OpenAPIHono();

function mapearReserva(reserva: any) {
  return {
    id: reserva.id,
    usuarioId: reserva.usuarioId,
    usuario: reserva.usuario
      ? {
          id: reserva.usuario.id,
          nombre: reserva.usuario.nombre,
          apellido: reserva.usuario.apellido,
          email: reserva.usuario.email,
          legajo: reserva.usuario.legajo ?? null,
        }
      : undefined,
    fechaHoraInicio: reserva.fechaHoraInicio.toISOString(),
    fechaHoraFin: reserva.fechaHoraFin.toISOString(),
    fechaLimiteCheckIn: reserva.fechaLimiteCheckIn.toISOString(),
    fechaHoraCancelacion: reserva.fechaHoraCancelacion?.toISOString() ?? null,
    motivoCancelacion: reserva.motivoCancelacion ?? null,
    fechaHoraCheckIn: reserva.fechaHoraCheckIn?.toISOString() ?? null,
    fechaHoraCheckOut: reserva.fechaHoraCheckOut?.toISOString() ?? null,
    observacion: reserva.observacion ?? null,
    recursos: (reserva.recursos ?? []).map((rr: any) => ({
      recursoId: rr.recursoId,
      recurso: {
        id: rr.recurso.id,
        nombre: rr.recurso.nombre,
        capacidad: rr.recurso.capacidad,
        activo: rr.recurso.activo ?? true,
        sala: rr.recurso.sala ? { ubicacion: rr.recurso.sala.ubicacion } : null,
        notebook: rr.recurso.notebook
          ? {
              marca: rr.recurso.notebook.marca,
              modelo: rr.recurso.notebook.modelo,
              numeroSerie: rr.recurso.notebook.numeroSerie,
            }
          : null,
      },
    })),
  };
}

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

const crearReservaRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Reservas"],
  summary: "Reservar un espacio y recursos asociados",
  description:
    "Crea una nueva reserva de espacio de trabajo, permitiendo opcionalmente vincular una notebook disponible.",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: crearReservaSchema },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: reservaResponseSchema,
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
      description: "No autenticado",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "No autorizado para crear reservas a nombre de otros usuarios",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Usuario o recurso especificado no encontrado",
    },
  },
});

const editarReservaRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Reservas"],
  summary: "Modificar reserva (vincular, cambiar o desvincular notebook)",
  description:
    "Permite actualizar la notebook asignada a una reserva activa que aún no ha iniciado ni realizado check-in.",
  security: [{ Bearer: [] }],
  request: {
    params: reservaParamsSchema,
    body: {
      content: {
        "application/json": { schema: editarReservaSchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: reservaResponseSchema },
      },
      description: "Reserva modificada exitosamente",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "Regla de negocio no cumplida (ej. ya finalizó o ya realizó check-in)",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autorizado para editar esta reserva",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Reserva o notebook no encontrada",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "Conflicto: la reserva está cancelada o la notebook está ocupada",
    },
  },
});

const cancelarReservaRoute = createRoute({
  method: "patch",
  path: "/{id}/cancelar",
  tags: ["Reservas"],
  summary: "Cancelar una reserva",
  description:
    "Cancela una reserva existente si el usuario es dueño de la misma o Administrador, liberando automáticamente el espacio y la notebook asociada.",
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
      description: "Reserva cancelada exitosamente y hardware liberado",
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

reservas.use("*", requireAuth);

reservas.openapi(listarReservasRoute, async (c) => {
  const usuarioAuth = c.get("usuario");
  const query = c.req.valid("query");

  const lista = await listarReservas(query, usuarioAuth);

  return c.json(
    {
      data: lista.map(mapearReserva),
    },
    200,
  );
});

reservas.openapi(crearReservaRoute, async (c) => {
  try {
    const usuarioAuth = c.get("usuario");
    const body = c.req.valid("json");

    const titularId = await resolverTitularReserva(body.usuarioId, usuarioAuth);

    const reserva = await crearReserva({
      ...body,
      usuarioId: titularId,
    });

    return c.json(
      {
        data: mapearReserva(reserva),
      },
      201,
    );
  } catch (error) {
    if (error instanceof ReservaNotFoundError) {
      return c.json({ message: error.message }, 404);
    }
    if (error instanceof ReservaForbiddenError) {
      return c.json({ message: error.message }, 403);
    }
    if (error instanceof DisponibilidadError) {
      return c.json({ message: error.message }, 400);
    }

    throw error;
  }
});

reservas.openapi(editarReservaRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const usuarioAuth = c.get("usuario");

    const reserva = await editarReserva(id, body, usuarioAuth);
    return c.json({ data: mapearReserva(reserva) }, 200);
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

reservas.openapi(cancelarReservaRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const usuarioAuth = c.get("usuario");

    const reserva = await cancelarReserva(id, body, usuarioAuth);

    return c.json(
      {
        data: mapearReserva(reserva),
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
