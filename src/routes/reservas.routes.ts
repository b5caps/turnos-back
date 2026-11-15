import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  crearReserva,
  DisponibilidadError,
  DURACION_HOLD_MINUTOS,
} from "../services/disponibilidad.service.js";
import {
  cancelarReserva,
  confirmarReserva,
  editarReserva,
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
  crearReservaSchema,
  editarReservaSchema,
  errorResponse,
  errorSchema,
  finalizarReservaBodySchema,
  finalizarReservaParamsSchema,
  finalizarReservaResponseSchema,
  listarReservasQuerySchema,
  listarReservasResponseSchema,
  reservaParamsSchema,
  reservaResponseSchema,
  unauthorizedResponse,
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
          legajo: reserva.usuario.perfilUTN?.legajo ?? null,
        }
      : undefined,
    fechaHoraInicio: reserva.fechaHoraInicio.toISOString(),
    fechaHoraFin: reserva.fechaHoraFin.toISOString(),
    fechaLimiteCheckIn: reserva.fechaLimiteCheckIn.toISOString(),
    fechaHoraConfirmacion:
      reserva.fechaHoraConfirmacion?.toISOString() ?? null,
    fechaExpiracionHold:
      reserva.fechaExpiracionHold?.toISOString() ?? null,
    confirmada: reserva.confirmada ?? (reserva.fechaHoraConfirmacion !== null),
    esPendiente: reserva.esPendiente ?? false,
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
    401: unauthorizedResponse,
  },
});

const crearReservaRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Reservas"],
  summary: "Reservar un espacio y recursos asociados",
  description:
    "Crea una reserva de recursos. Los usuarios comunes inician una Reserva Pendiente (Hold de 10 min) que debe confirmarse. Los administradores pueden además reservar en nombre de otros usuarios o confirmar de forma inmediata.",
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
      description: "Reserva iniciada exitosamente (en reserva pendiente o confirmada)",
    },
    400: errorResponse("Solicitud inválida o recursos no disponibles"),
    401: unauthorizedResponse,
    403: errorResponse("No autorizado para reservar en nombre de otro usuario o confirmar de inmediato"),
    404: errorResponse("Usuario o recurso especificado no encontrado"),
    409: errorResponse("Uno o más recursos ya se encuentran reservados o bloqueados en ese horario"),
  },
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
    400: errorResponse(
      "Regla de negocio no cumplida (ej. ya finalizó o ya realizó check-in)",
    ),
    401: unauthorizedResponse,
    403: errorResponse("No autorizado para editar esta reserva"),
    404: errorResponse("Reserva o notebook no encontrada"),
    409: errorResponse(
      "Conflicto: la reserva está cancelada o la notebook está ocupada",
    ),
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
    400: errorResponse(
      "Regla de negocio no cumplida (ej. ya finalizó o ya realizó check-in)",
    ),
    401: unauthorizedResponse,
    403: errorResponse("No autorizado para cancelar esta reserva"),
    404: errorResponse("Reserva no encontrada"),
    409: errorResponse("La reserva ya se encuentra cancelada"),
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
          data: mapearReserva({
            ...resultado,
            confirmada: true,
            esPendiente: false,
          }),
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
          usuario: undefined,
          fechaHoraInicio: resultado.fechaHoraDeseadaInicio.toISOString(),
          fechaHoraFin: resultado.fechaHoraDeseadaFin.toISOString(),
          fechaLimiteCheckIn: resultado.fechaHoraDeseadaInicio.toISOString(),
          fechaHoraConfirmacion: null,
          fechaExpiracionHold: expiracionHold.toISOString(),
          confirmada: false,
          esPendiente: true,
          fechaHoraCancelacion: null,
          motivoCancelacion: null,
          fechaHoraCheckIn: null,
          fechaHoraCheckOut: null,
          observacion: body.observacion ?? null,
          recursos: (resultado.recursos ?? []).map((rr: any) => ({
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

reservas.openapi(confirmarReservaRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const usuarioAuth = c.get("usuario");

    const reserva = await confirmarReserva(id, usuarioAuth);

    return c.json(
      {
        data: mapearReserva({
          ...reserva,
          confirmada: true,
          esPendiente: false,
        }),
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

reservas.use("/:id/finalizar", requireAuth);

reservas.openapi(finalizarReservaRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const usuarioAuth = c.get("usuario");

    const reserva = await finalizarReserva(id, body, usuarioAuth);

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
