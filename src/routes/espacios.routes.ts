import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  actualizarEspacioSchema,
  crearEspacioSchema,
  eliminarEspacioResponseSchema,
  errorSchema,
  espacioParamsSchema,
  espacioResponseSchema,
  listarEspaciosQuerySchema,
  listarEspaciosResponseSchema,
} from "../schemas/espacios.schema.js";
import {
  actualizarEspacio,
  crearEspacio,
  eliminarODesactivarEspacio,
  EspacioBusinessError,
  EspacioConflictError,
  EspacioNotFoundError,
  listarEspacios,
  obtenerEspacioPorId,
} from "../services/espacios.service.js";

const espacios = new OpenAPIHono();

// GET / - Listar espacios
const listarEspaciosRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Espacios"],
  summary: "Listar espacios (salas)",
  description:
    "Obtiene la lista de todos los espacios físicos registrados en el establecimiento. Permite filtrar por estado activo.",
  security: [{ Bearer: [] }],
  request: {
    query: listarEspaciosQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: listarEspaciosResponseSchema,
        },
      },
      description: "Lista de espacios obtenida exitosamente",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado",
    },
  },
});

// GET /:id - Detalle de espacio
const obtenerEspacioRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Espacios"],
  summary: "Obtener detalle de un espacio",
  security: [{ Bearer: [] }],
  request: {
    params: espacioParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: espacioResponseSchema,
        },
      },
      description: "Detalle del espacio",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Espacio no encontrado",
    },
  },
});

// POST / - Crear nuevo espacio (ADMIN)
const crearEspacioRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Espacios"],
  summary: "Registrar un nuevo espacio (Solo Administrador)",
  description:
    "Crea un nuevo espacio físico con su nombre, capacidad, descripción y ubicación. Exclusivo para administradores.",
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: crearEspacioSchema },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: espacioResponseSchema,
        },
      },
      description: "Espacio creado exitosamente",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Datos obligatorios faltantes o inválidos",
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

// PATCH /:id - Actualizar espacio (ADMIN)
const actualizarEspacioRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Espacios"],
  summary: "Actualizar un espacio existente (Solo Administrador)",
  security: [{ Bearer: [] }],
  request: {
    params: espacioParamsSchema,
    body: {
      content: {
        "application/json": { schema: actualizarEspacioSchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: espacioResponseSchema,
        },
      },
      description: "Espacio actualizado exitosamente",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Datos de actualización inválidos",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "Acceso denegado: se requieren permisos de administrador",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Espacio no encontrado",
    },
  },
});

// DELETE /:id - Eliminar o desactivar espacio (ADMIN)
const eliminarEspacioRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Espacios"],
  summary: "Eliminar o desactivar lógicamente un espacio (Solo Administrador)",
  description:
    "Elimina físicamente el espacio si no tiene reservas, o lo desactiva lógicamente si posee historial previo. Impide el borrado si posee reservas activas o futuras.",
  security: [{ Bearer: [] }],
  request: {
    params: espacioParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: eliminarEspacioResponseSchema,
        },
      },
      description: "Espacio eliminado o desactivado lógicamente",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "No autenticado",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "Acceso denegado: se requieren permisos de administrador",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Espacio no encontrado",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "Conflicto: el espacio posee reservas activas o futuras",
    },
  },
});

espacios.use("*", requireAuth);

// Handlers
espacios.openapi(listarEspaciosRoute, async (c) => {
  const query = c.req.valid("query");
  const lista = await listarEspacios(query);
  return c.json({ data: lista }, 200);
});

espacios.openapi(obtenerEspacioRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const data = await obtenerEspacioPorId(id);
    return c.json({ data }, 200);
  } catch (error) {
    if (error instanceof EspacioNotFoundError) {
      return c.json({ message: error.message }, 404);
    }
    throw error;
  }
});

espacios.openapi(crearEspacioRoute, async (c) => {
  try {
    const usuarioAuth = c.get("usuario");
    if (usuarioAuth.rol !== "ADMIN") {
      return c.json(
        { message: "Acceso denegado: se requieren permisos de administrador" },
        403,
      );
    }

    const body = c.req.valid("json");
    const data = await crearEspacio(body);
    return c.json({ data }, 201);
  } catch (error) {
    if (error instanceof EspacioBusinessError) {
      return c.json({ message: error.message }, 400);
    }
    throw error;
  }
});

espacios.openapi(actualizarEspacioRoute, async (c) => {
  try {
    const usuarioAuth = c.get("usuario");
    if (usuarioAuth.rol !== "ADMIN") {
      return c.json(
        { message: "Acceso denegado: se requieren permisos de administrador" },
        403,
      );
    }

    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const data = await actualizarEspacio(id, body);
    return c.json({ data }, 200);
  } catch (error) {
    if (error instanceof EspacioNotFoundError) {
      return c.json({ message: error.message }, 404);
    }
    if (error instanceof EspacioBusinessError) {
      return c.json({ message: error.message }, 400);
    }
    throw error;
  }
});

espacios.openapi(eliminarEspacioRoute, async (c) => {
  try {
    const usuarioAuth = c.get("usuario");
    if (usuarioAuth.rol !== "ADMIN") {
      return c.json(
        { message: "Acceso denegado: se requieren permisos de administrador" },
        403,
      );
    }

    const { id } = c.req.valid("param");
    const resultado = await eliminarODesactivarEspacio(id);
    return c.json(resultado, 200);
  } catch (error) {
    if (error instanceof EspacioNotFoundError) {
      return c.json({ message: error.message }, 404);
    }
    if (error instanceof EspacioConflictError) {
      return c.json({ message: error.message }, 409);
    }
    throw error;
  }
});

export default espacios;
