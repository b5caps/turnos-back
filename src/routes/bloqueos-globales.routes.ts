import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Bloqueo } from "@prisma/client";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { validationHook } from "../lib/validation.js";
import {
  bloqueoIdParamsSchema,
  bloqueoSchema,
  crearBloqueoGlobalResponseSchema,
  crearBloqueoGlobalSchema,
  listarBloqueosCalendarioQuerySchema,
} from "../schemas/bloqueos.schema.js";
import { errorResponse } from "../schemas/reservas.schema.js";
import {
  BloqueoBusinessError,
  BloqueoForbiddenError,
  BloqueoNotFoundError,
  crearBloqueoGlobal,
  eliminarBloqueoPorId,
  listarBloqueosCalendario,
} from "../services/bloqueos.service.js";

const bloqueosGlobales = new OpenAPIHono({ defaultHook: validationHook });

const errores = {
  400: errorResponse("Datos o rango temporal inválidos"),
  401: errorResponse("No autenticado"),
  403: errorResponse("Se requieren permisos de administrador"),
  404: errorResponse("Espacio o bloqueo no encontrado"),
};

type BloqueoConRecurso = Bloqueo & {
  recurso?: {
    id: number;
    nombre: string;
    sala?: { ubicacion: string } | null;
  } | null;
};

function serializarBloqueo(bloqueo: BloqueoConRecurso) {
  return {
    id: bloqueo.id,
    recursoId: bloqueo.recursoId,
    ...(bloqueo.recurso !== undefined
      ? {
          recurso: bloqueo.recurso
            ? {
                id: bloqueo.recurso.id,
                nombre: bloqueo.recurso.nombre,
                ubicacion: bloqueo.recurso.sala?.ubicacion ?? null,
              }
            : null,
        }
      : {}),
    fechaHoraInicio: bloqueo.fechaHoraInicio.toISOString(),
    fechaHoraFin: bloqueo.fechaHoraFin?.toISOString() ?? null,
    motivo: bloqueo.motivo,
    fechaCreacion: bloqueo.fechaCreacion.toISOString(),
    creadoPorId: bloqueo.creadoPorId,
  };
}

bloqueosGlobales.use("*", requireAuth);
bloqueosGlobales.use("*", async (c, next) => {
  if (c.get("usuario").rol !== "ADMIN") {
    return c.json({ message: "Se requieren permisos de administrador" }, 403);
  }
  await next();
});

bloqueosGlobales.onError((error, c) => {
  if (error instanceof BloqueoNotFoundError) {
    return c.json({ message: error.message }, 404);
  }
  if (error instanceof BloqueoForbiddenError) {
    return c.json({ message: error.message }, 403);
  }
  if (error instanceof BloqueoBusinessError) {
    return c.json({ message: error.message }, 400);
  }
  throw error;
});

bloqueosGlobales.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["Bloqueos"],
    summary: "Crear bloqueo por sala o global y cancelar reservas afectadas (ADMIN)",
    description:
      "Crea un bloqueo para una sala específica (recursoId) o para todo el establecimiento (recursoId: null), cancelando todas las reservas activas y liberando holds solapados.",
    security: [{ Bearer: [] }],
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: crearBloqueoGlobalSchema },
        },
      },
    },
    responses: {
      ...errores,
      201: {
        description: "Bloqueo creado y reservas afectadas canceladas",
        content: {
          "application/json": { schema: crearBloqueoGlobalResponseSchema },
        },
      },
    },
  }),
  async (c) => {
    const resultado = await crearBloqueoGlobal(
      c.req.valid("json"),
      c.get("usuario"),
    );
    return c.json(
      {
        data: serializarBloqueo(resultado.bloqueo),
        reservasCanceladas: resultado.reservasCanceladas,
        holdsLiberados: resultado.holdsLiberados,
      },
      201,
    );
  },
);

bloqueosGlobales.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Bloqueos"],
    summary: "Listar bloqueos globales y por sala en un rango (ADMIN)",
    description:
      "Lista los bloqueos que solapan el rango desde/hasta (acepta YYYY-MM-DD o timestamps ISO con zona horaria) para renderizar el calendario mensual.",
    security: [{ Bearer: [] }],
    request: {
      query: listarBloqueosCalendarioQuerySchema,
    },
    responses: {
      ...errores,
      200: {
        description: "Listado de bloqueos",
        content: {
          "application/json": {
            schema: z.object({ data: z.array(bloqueoSchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const data = await listarBloqueosCalendario(
      c.req.valid("query"),
      c.get("usuario"),
    );
    return c.json({ data: data.map(serializarBloqueo) }, 200);
  },
);

bloqueosGlobales.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["Bloqueos"],
    summary: "Eliminar un bloqueo por ID (ADMIN)",
    security: [{ Bearer: [] }],
    request: { params: bloqueoIdParamsSchema },
    responses: {
      ...errores,
      204: {
        description: "Bloqueo eliminado exitosamente",
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    await eliminarBloqueoPorId(id, c.get("usuario"));
    return c.body(null, 204);
  },
);

export default bloqueosGlobales;
