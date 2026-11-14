import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  asistenciaSchema,
  idAsistenciaSchema,
  qrEmitidoSchema,
  tokenQrSchema,
} from "../schemas/asistencia.schema.js";
import { errorResponse } from "../schemas/reservas.schema.js";
import {
  AsistenciaConflictError,
  AsistenciaForbiddenError,
  AsistenciaNotFoundError,
  consultarReservasParaQr,
  emitirQrEspacio,
  registrarCheckIn,
  revocarQrEspacio,
} from "../services/asistencia.service.js";

const asistencia = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success)
      return c.json(
        { message: result.error.issues.map((i) => i.message).join("; ") },
        400,
      );
  },
});
asistencia.use("*", requireAuth);
asistencia.onError((error, c) => {
  if (error instanceof AsistenciaNotFoundError)
    return c.json({ message: error.message }, 404);
  if (error instanceof AsistenciaForbiddenError)
    return c.json({ message: error.message }, 403);
  if (error instanceof AsistenciaConflictError)
    return c.json({ message: error.message }, 409);
  throw error;
});

const errores = {
  400: errorResponse("Datos inválidos"),
  401: errorResponse("No autenticado"),
  403: errorResponse("Sin permisos para esta operación"),
  404: errorResponse("Reserva, espacio o QR no encontrado"),
  409: errorResponse(
    "La reserva no admite check-in o el QR corresponde a otro espacio",
  ),
};
const json = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});
const comunes = { tags: ["Asistencia"], security: [{ Bearer: [] }] };

asistencia.openapi(
  createRoute({
    ...comunes,
    method: "post",
    path: "/espacios/{id}/qr",
    summary: "Emitir o reemplazar el QR imprimible de un espacio (ADMIN)",
    description:
      "Devuelve URL, token y SVG una sola vez. Reemplazarlo revoca el QR anterior. Configurar CHECK_IN_URL con la página que consumirá el enlace.",
    request: { params: idAsistenciaSchema },
    responses: {
      ...errores,
      201: {
        description: "QR emitido",
        content: json(z.object({ data: qrEmitidoSchema })),
      },
    },
  }),
  async (c) => {
    const data = await emitirQrEspacio(
      c.req.valid("param").id,
      c.get("usuario"),
    );
    c.header("Cache-Control", "no-store");
    return c.json({ data }, 201);
  },
);

asistencia.openapi(
  createRoute({
    ...comunes,
    method: "delete",
    path: "/espacios/{id}/qr",
    summary: "Revocar el QR vigente de un espacio (ADMIN)",
    request: { params: idAsistenciaSchema },
    responses: { ...errores, 204: { description: "QR revocado" } },
  }),
  async (c) => {
    await revocarQrEspacio(c.req.valid("param").id, c.get("usuario"));
    return c.body(null, 204);
  },
);

asistencia.openapi(
  createRoute({
    ...comunes,
    method: "post",
    path: "/reservas/check-in/consultar",
    summary: "Consultar reservas propias elegibles al escanear un QR",
    description:
      "No registra asistencia. Devuelve únicamente reservas confirmadas propias del espacio, en curso y dentro de plazo, o con asistencia ya registrada.",
    request: { body: { required: true, content: json(tokenQrSchema) } },
    responses: {
      ...errores,
      200: {
        description: "Reservas elegibles",
        content: json(
          z.object({
            data: z.object({
              recursoId: z.number().int(),
              reservas: z.array(asistenciaSchema),
            }),
          }),
        ),
      },
    },
  }),
  async (c) => {
    const data = await consultarReservasParaQr(
      c.req.valid("json").tokenQr,
      c.get("usuario"),
    );
    return c.json({ data }, 200);
  },
);

asistencia.openapi(
  createRoute({
    ...comunes,
    method: "post",
    path: "/reservas/{id}/check-in",
    summary: "Registrar la llegada a una reserva propia mediante QR",
    description:
      "Requiere reserva confirmada, QR vigente del espacio y hora del servidor en [inicio, límite). Los reintentos preservan la asistencia original.",
    request: {
      params: idAsistenciaSchema,
      body: { required: true, content: json(tokenQrSchema) },
    },
    responses: {
      ...errores,
      200: {
        description: "Asistencia registrada",
        content: json(z.object({ data: asistenciaSchema })),
      },
    },
  }),
  async (c) => {
    return c.json(
      {
        data: await registrarCheckIn(
          c.req.valid("param").id,
          c.get("usuario"),
          c.req.valid("json").tokenQr,
        ),
      },
      200,
    );
  },
);

asistencia.openapi(
  createRoute({
    ...comunes,
    method: "post",
    path: "/reservas/{id}/check-in/manual",
    summary: "Registrar manualmente la asistencia (ADMIN)",
    description:
      "Permite registrar la llegada del titular dentro del mismo plazo, conservando la autoría del administrador. No admite fechas provistas por el cliente.",
    request: { params: idAsistenciaSchema },
    responses: {
      ...errores,
      200: {
        description: "Asistencia registrada",
        content: json(z.object({ data: asistenciaSchema })),
      },
    },
  }),
  async (c) => {
    return c.json(
      {
        data: await registrarCheckIn(c.req.valid("param").id, c.get("usuario")),
      },
      200,
    );
  },
);

export default asistencia;
