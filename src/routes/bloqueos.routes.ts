import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Bloqueo } from "@prisma/client";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  bloqueoSchema,
  crearBloqueoSchema,
  eliminarBloqueoParamsSchema,
  espacioBloqueoParamsSchema,
  listarBloqueosQuerySchema,
} from "../schemas/bloqueos.schema.js";
import { errorResponse } from "../schemas/reservas.schema.js";
import {
  BloqueoForbiddenError,
  BloqueoNotFoundError,
  crearBloqueo,
  eliminarBloqueo,
  listarBloqueos,
} from "../services/bloqueos.service.js";

const bloqueos = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success)
      return c.json(
        { message: result.error.issues.map((i) => i.message).join("; ") },
        400,
      );
  },
});

const errores = {
  400: errorResponse("Datos o rango temporal inválidos"),
  401: errorResponse("No autenticado"),
  403: errorResponse("Se requieren permisos de administrador"),
  404: errorResponse("Espacio o bloqueo no encontrado"),
};

function serializar(bloqueo: Bloqueo) {
  return {
    ...bloqueo,
    fechaHoraInicio: bloqueo.fechaHoraInicio.toISOString(),
    fechaHoraFin: bloqueo.fechaHoraFin?.toISOString() ?? null,
    fechaCreacion: bloqueo.fechaCreacion.toISOString(),
  };
}

bloqueos.use("*", requireAuth);
bloqueos.use("*", async (c, next) => {
  if (c.get("usuario").rol !== "ADMIN")
    return c.json({ message: "Se requieren permisos de administrador" }, 403);
  await next();
});
bloqueos.onError((error, c) => {
  if (error instanceof BloqueoNotFoundError)
    return c.json({ message: error.message }, 404);
  if (error instanceof BloqueoForbiddenError)
    return c.json({ message: error.message }, 403);
  throw error;
});

bloqueos.openapi(
  createRoute({
    method: "post",
    path: "/{id}/bloqueos",
    tags: ["Bloqueos"],
    summary:
      "Bloquear una franja, días completos o un intervalo indefinido (ADMIN)",
    description:
      "Los días completos incluyen fechaDesde y fechaHasta en America/Argentina/Buenos_Aires. FRANJA usa [inicio, fin); fin null indica bloqueo indefinido. Conserva reservas confirmadas e impide confirmar holds superpuestos.",
    security: [{ Bearer: [] }],
    request: {
      params: espacioBloqueoParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: crearBloqueoSchema } },
      },
    },
    responses: {
      ...errores,
      201: {
        description: "Bloqueo creado",
        content: {
          "application/json": { schema: z.object({ data: bloqueoSchema }) },
        },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const data = await crearBloqueo(id, c.req.valid("json"), c.get("usuario"));
    return c.json({ data: serializar(data) }, 201);
  },
);

bloqueos.openapi(
  createRoute({
    method: "get",
    path: "/{id}/bloqueos",
    tags: ["Bloqueos"],
    summary: "Listar bloqueos de un espacio (ADMIN)",
    description:
      "Desde/hasta son timestamps con zona horaria y filtran por solapamiento, incluidos bloqueos indefinidos. Sin filtros devuelve también el historial.",
    security: [{ Bearer: [] }],
    request: {
      params: espacioBloqueoParamsSchema,
      query: listarBloqueosQuerySchema,
    },
    responses: {
      ...errores,
      200: {
        description: "Bloqueos del espacio",
        content: {
          "application/json": {
            schema: z.object({ data: z.array(bloqueoSchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const data = await listarBloqueos(
      id,
      c.req.valid("query"),
      c.get("usuario"),
    );
    return c.json({ data: data.map(serializar) }, 200);
  },
);

bloqueos.openapi(
  createRoute({
    method: "delete",
    path: "/{id}/bloqueos/{bloqueoId}",
    tags: ["Bloqueos"],
    summary: "Eliminar un bloqueo de un espacio (ADMIN)",
    security: [{ Bearer: [] }],
    request: { params: eliminarBloqueoParamsSchema },
    responses: {
      ...errores,
      204: {
        description:
          "Bloqueo eliminado; deja de restringir inmediatamente la disponibilidad",
      },
    },
  }),
  async (c) => {
    const { id, bloqueoId } = c.req.valid("param");
    await eliminarBloqueo(id, bloqueoId, c.get("usuario"));
    return c.body(null, 204);
  },
);

export default bloqueos;
