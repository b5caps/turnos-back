import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { validationHook } from "../lib/validation.js";
import {
  actualizarFeriadoSchema,
  crearFeriadoSchema,
  feriadoMutationResponseSchema,
  feriadoParamsSchema,
  listarFeriadosQuerySchema,
  listarFeriadosResponseSchema,
} from "../schemas/feriados.schema.js";
import { errorResponse } from "../schemas/reservas.schema.js";
import {
  actualizarFeriado,
  crearFeriado,
  FeriadoBusinessError,
  FeriadoConflictError,
  FeriadoForbiddenError,
  FeriadoNotFoundError,
  listarFeriadosPorAnio,
} from "../services/feriados.service.js";

const feriados = new OpenAPIHono({ defaultHook: validationHook });

feriados.onError((error, c) => {
  if (error instanceof FeriadoBusinessError) {
    return c.json({ message: error.message }, 400);
  }
  if (error instanceof FeriadoForbiddenError) {
    return c.json({ message: error.message }, 403);
  }
  if (error instanceof FeriadoNotFoundError) {
    return c.json({ message: error.message }, 404);
  }
  if (error instanceof FeriadoConflictError) {
    return c.json({ message: error.message }, 409);
  }
  throw error;
});

feriados.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["Feriados"],
    summary: "Listar feriados del año (Público)",
    description:
      "Devuelve los feriados registrados para el año consultado (por defecto el año vigente en Argentina).",
    request: {
      query: listarFeriadosQuerySchema,
    },
    responses: {
      200: {
        description: "Lista de feriados del año",
        content: {
          "application/json": { schema: listarFeriadosResponseSchema },
        },
      },
      400: errorResponse("Año inválido"),
    },
  }),
  async (c) => {
    const resultado = await listarFeriadosPorAnio(c.req.valid("query"));
    return c.json(resultado, 200);
  },
);

feriados.use("/", async (c, next) => {
  if (c.req.method === "POST") {
    return requireAuth(c, next);
  }
  await next();
});
feriados.use("/:id", requireAuth);

feriados.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["Feriados"],
    summary: "Agregar un feriado manual (ADMIN)",
    description:
      "Registra un feriado (fecha >= hoy) y cancela automáticamente todas las reservas activas y holds de ese día.",
    security: [{ Bearer: [] }],
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: crearFeriadoSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Feriado creado y reservas afectadas canceladas",
        content: {
          "application/json": { schema: feriadoMutationResponseSchema },
        },
      },
      400: errorResponse("Fecha pasada o datos inválidos"),
      401: errorResponse("No autenticado"),
      403: errorResponse("Se requieren permisos de administrador"),
      409: errorResponse("Ya existe un feriado para esa fecha"),
    },
  }),
  async (c) => {
    const resultado = await crearFeriado(
      c.req.valid("json"),
      c.get("usuario"),
    );
    return c.json(resultado, 201);
  },
);

feriados.openapi(
  createRoute({
    method: "patch",
    path: "/{id}",
    tags: ["Feriados"],
    summary: "Editar fecha o nombre de un feriado (ADMIN)",
    description:
      "Edita nombre y/o fecha de un feriado existente. Si cambia la fecha, exige fecha >= hoy y cancela reservas activas y holds de la nueva fecha.",
    security: [{ Bearer: [] }],
    request: {
      params: feriadoParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: actualizarFeriadoSchema },
        },
      },
    },
    responses: {
      200: {
        description: "Feriado actualizado",
        content: {
          "application/json": { schema: feriadoMutationResponseSchema },
        },
      },
      400: errorResponse("Fecha pasada o datos inválidos"),
      401: errorResponse("No autenticado"),
      403: errorResponse("Se requieren permisos de administrador"),
      404: errorResponse("Feriado no encontrado"),
      409: errorResponse("Ya existe un feriado para esa fecha"),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const resultado = await actualizarFeriado(
      id,
      c.req.valid("json"),
      c.get("usuario"),
    );
    return c.json(resultado, 200);
  },
);

export default feriados;
