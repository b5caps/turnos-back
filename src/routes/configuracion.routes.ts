import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  actualizarConfiguracionSchema,
  configuracionResponseSchema,
  errorSchema,
} from "../schemas/configuracion.schema.js";
import {
  actualizarConfiguracion,
  ConfiguracionBusinessError,
  obtenerConfiguracion,
} from "../services/configuracion.service.js";

const configuracion = new OpenAPIHono();

// GET / - Consultar configuración global (ADMIN)
const obtenerConfiguracionRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Configuración"],
  summary: "Consultar parámetros globales del establecimiento (Solo Administrador)",
  description:
    "Obtiene los parámetros institucionales vigentes: horarios de apertura/cierre, tiempo máximo de antelación y duraciones de reserva.",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: configuracionResponseSchema,
        },
      },
      description: "Configuración global obtenida exitosamente",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "Acceso denegado: se requieren permisos de administrador",
    },
  },
});

// PATCH / - Actualizar parámetros globales (ADMIN)
const actualizarConfiguracionRoute = createRoute({
  method: "patch",
  path: "/",
  tags: ["Configuración"],
  summary: "Actualizar parámetros globales del establecimiento (Solo Administrador)",
  description:
    "Modifica los parámetros de configuración global del sistema y aplica los cambios en tiempo real.",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: actualizarConfiguracionSchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: configuracionResponseSchema,
        },
      },
      description: "Configuración global actualizada exitosamente",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Valores inconsistentes o inválidos",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "Acceso denegado: se requieren permisos de administrador",
    },
  },
});

configuracion.use("*", requireAuth);

configuracion.openapi(obtenerConfiguracionRoute, async (c) => {
  const usuarioAuth = c.get("usuario");
  if (usuarioAuth.rol !== "ADMIN") {
    return c.json(
      { message: "Acceso denegado: se requieren permisos de administrador" },
      403,
    );
  }

  const data = await obtenerConfiguracion();
  return c.json({ data }, 200);
});

configuracion.openapi(actualizarConfiguracionRoute, async (c) => {
  try {
    const usuarioAuth = c.get("usuario");
    if (usuarioAuth.rol !== "ADMIN") {
      return c.json(
        { message: "Acceso denegado: se requieren permisos de administrador" },
        403,
      );
    }

    const body = c.req.valid("json");
    const data = await actualizarConfiguracion(body);
    return c.json({ data }, 200);
  } catch (error) {
    if (error instanceof ConfiguracionBusinessError) {
      return c.json({ message: error.message }, 400);
    }
    throw error;
  }
});

export default configuracion;
