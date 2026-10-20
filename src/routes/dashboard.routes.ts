import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  dashboardQuerySchema,
  dashboardResponseSchema,
  errorSchema,
} from "../schemas/dashboard.schema.js";
import { obtenerMetricasDashboard } from "../services/dashboard.service.js";

const dashboard = new OpenAPIHono();

const dashboardRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Dashboard"],
  summary: "Consultar métricas y resumen del dashboard",
  description:
    "Provee métricas clave actualizadas del sistema: resumen de reservas del día, tasa de ocupación (instantánea y diaria) con desglose por categoría y cancelaciones recientes. Requiere rol de Administrador.",
  security: [{ Bearer: [] }],
  request: {
    query: dashboardQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: dashboardResponseSchema,
        },
      },
      description: "Métricas del dashboard obtenidas exitosamente",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Parámetros de consulta inválidos",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado o token no provisto/inválido",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "Acceso denegado: se requieren permisos de administrador",
    },
    500: {
      content: { "application/json": { schema: errorSchema } },
      description: "Error interno al procesar las métricas",
    },
  },
});

dashboard.use("*", requireAuth);

dashboard.openapi(dashboardRoute, async (c) => {
  try {
    const usuarioAuth = c.get("usuario");

    // CA01: Solo administradores
    if (usuarioAuth.rol !== "ADMIN") {
      return c.json(
        { message: "Acceso denegado: se requieren permisos de administrador" },
        403,
      );
    }

    const query = c.req.valid("query");
    const data = await obtenerMetricasDashboard(query);

    return c.json({ data }, 200);
  } catch (error) {
    console.error("Error al obtener métricas del dashboard:", error);
    return c.json(
      { message: "Error interno al generar las métricas del dashboard" },
      500,
    );
  }
});

export default dashboard;
