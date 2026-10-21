// src/routes/recursos.routes.ts
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  consultarDisponibilidadNotebooks,
  consultarDisponibilidadSalas,
} from "../services/disponibilidad.service.js";
import {
  obtenerAsignacionesNotebooks,
  ReservaForbiddenError,
} from "../services/reservas.service.js";
import {
  errorSchema,
  notebookAsignacionesQuerySchema,
  notebookAsignacionesResponseSchema,
} from "../schemas/reservas.schema.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const recursos = new OpenAPIHono();

const querySchema = z.object({
  fecha: z.iso.date("Formato YYYY-MM-DD requerido").openapi({
    example: "2026-09-05",
    description: "Fecha a consultar (YYYY-MM-DD)",
  }),
});

const notebooksQuerySchema = z.object({
  fecha: z.iso.date("Formato YYYY-MM-DD requerido").openapi({
    example: "2026-09-05",
    description: "Fecha a consultar (YYYY-MM-DD)",
  }),
  desde: z.string().optional().openapi({
    example: "14:00",
    description:
      "Hora o fecha de inicio del turno a consultar (HH:mm o ISO string)",
  }),
  hasta: z.string().optional().openapi({
    example: "16:00",
    description:
      "Hora o fecha de fin del turno a consultar (HH:mm o ISO string)",
  }),
});

const bloqueDisponibilidadSchema = z.object({
  horaInicio: z.string(),
  horaFin: z.string(),
  ocupacion: z.number(),
  disponible: z.boolean(),
  motivoNoDisponible: z
    .enum(["fuera_de_horario", "bloqueado", "sin_cupos"])
    .nullable(),
});

const disponibilidadBaseSchema = z.object({
  id: z.number(),
  nombre: z.string(),
  capacidad: z.number(),
  horariosReservados: z.array(
    z.object({ horaInicio: z.string(), horaFin: z.string() }),
  ),
  bloques: z.array(bloqueDisponibilidadSchema),
});

const horarioEstablecimientoSchema = z.object({
  minutosApertura: z.number().int().openapi({ example: 480 }),
  minutosCierre: z.number().int().openapi({ example: 1320 }),
});

const salasResponseSchema = z.object({
  horarioEstablecimiento: horarioEstablecimientoSchema,
  recursos: z.array(
    disponibilidadBaseSchema.extend({
      ubicacion: z.string(),
    }),
  ),
});

const notebooksResponseSchema = z.object({
  horarioEstablecimiento: horarioEstablecimientoSchema,
  recursos: z.array(
    disponibilidadBaseSchema.extend({
      numeroSerie: z.string(),
      marca: z.string(),
      modelo: z.string(),
      disponibleEnTurno: z.boolean().optional().openapi({
        example: true,
        description:
          "Indica si la notebook está 100% disponible durante el turno indicado en 'desde' y 'hasta'",
      }),
    }),
  ),
});

const disponibilidadSalasRoute = createRoute({
  method: "get",
  path: "/disponibilidad/salas",
  tags: ["Recursos"],
  summary: "Consultar disponibilidad de salas",
  request: { query: querySchema },
  responses: {
    200: {
      content: { "application/json": { schema: salasResponseSchema } },
      description: "OK",
    },
    400: { description: "Parámetros inválidos" },
  },
});

const disponibilidadNotebooksRoute = createRoute({
  method: "get",
  path: "/disponibilidad/notebooks",
  tags: ["Recursos"],
  summary: "Consultar disponibilidad de notebooks",
  description:
    "Permite consultar bloques de disponibilidad de notebooks para una fecha, con soporte opcional de filtro por turno ('desde' y 'hasta') para asistir en la selección del formulario de reserva.",
  request: { query: notebooksQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: notebooksResponseSchema } },
      description: "OK",
    },
    400: { description: "Parámetros inválidos" },
  },
});

const asignacionesNotebooksRoute = createRoute({
  method: "get",
  path: "/notebooks/asignaciones",
  tags: ["Recursos"],
  summary:
    "Consultar asignaciones y custodia de notebooks (Solo Administrador)",
  description:
    "Permite a los administradores visualizar el estado de cada notebook institucional y el usuario titular al que está asignada en un momento o fecha determinada (CA05).",
  security: [{ Bearer: [] }],
  request: { query: notebookAsignacionesQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": { schema: notebookAsignacionesResponseSchema },
      },
      description: "Listado de inventario de notebooks con asignaciones actuales",
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

recursos.openapi(disponibilidadSalasRoute, async (c) => {
  const params = c.req.valid("query");
  const resultado = await consultarDisponibilidadSalas(params);
  return c.json(resultado);
});

recursos.openapi(disponibilidadNotebooksRoute, async (c) => {
  const params = c.req.valid("query");
  const resultado = await consultarDisponibilidadNotebooks(params);
  return c.json(resultado);
});

recursos.use("/notebooks/asignaciones", requireAuth);

recursos.openapi(asignacionesNotebooksRoute, async (c) => {
  try {
    const usuarioAuth = c.get("usuario");
    if (usuarioAuth.rol !== "ADMIN") {
      return c.json(
        { message: "Acceso denegado: se requieren permisos de administrador" },
        403,
      );
    }

    const query = c.req.valid("query");
    const lista = await obtenerAsignacionesNotebooks(query, usuarioAuth);
    return c.json({ data: lista }, 200);
  } catch (error) {
    if (error instanceof ReservaForbiddenError) {
      return c.json({ message: error.message }, 403);
    }
    throw error;
  }
});

export default recursos;
