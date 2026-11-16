import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { validationHook } from "../lib/validation.js";
import {
  listarFeriadosQuerySchema,
  listarFeriadosResponseSchema,
} from "../schemas/feriados.schema.js";
import { errorResponse } from "../schemas/reservas.schema.js";
import { listarFeriadosPorAnio } from "../services/feriados.service.js";

const feriados = new OpenAPIHono({ defaultHook: validationHook });

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

export default feriados;
