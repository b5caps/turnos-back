import { z } from "@hono/zod-openapi";

export const cancelarReservaParamsSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: {
        name: "id",
        in: "path",
      },
      example: 1,
      description: "ID de la reserva a cancelar",
    }),
});

export const cancelarReservaBodySchema = z.object({
  motivoCancelacion: z.string().trim().min(1).max(255).optional().openapi({
    example: "Imprevisto laboral",
    description: "Motivo o justificación de la cancelación",
  }),
});

export const reservaDetalleSchema = z.object({
  id: z.number(),
  usuarioId: z.number(),
  usuario: z
    .object({
      id: z.number(),
      nombre: z.string(),
      apellido: z.string(),
      email: z.string(),
    })
    .optional(),
  fechaHoraInicio: z.string(),
  fechaHoraFin: z.string(),
  fechaLimiteCheckIn: z.string(),
  fechaHoraConfirmacion: z.string().nullable().optional(),
  fechaExpiracionHold: z.string().nullable().optional(),
  confirmada: z.boolean().optional(),
  esPendiente: z.boolean().optional(),
  fechaHoraCancelacion: z.string().nullable(),
  motivoCancelacion: z.string().nullable(),
  fechaHoraCheckIn: z.string().nullable().optional(),
  fechaHoraCheckOut: z.string().nullable().optional(),
  observacion: z.string().nullable(),
  recursos: z.array(
    z.object({
      recursoId: z.number(),
      recurso: z.object({
        id: z.number(),
        nombre: z.string(),
      }),
    }),
  ),
});

export const listarReservasQuerySchema = z.object({
  usuarioId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .openapi({
      param: {
        name: "usuarioId",
        in: "query",
      },
      description: "Filtrar por usuario (solo disponible para administradores)",
      example: 1,
    }),
  estado: z
    .enum(["todas", "activas", "canceladas", "finalizadas", "pendientes"])
    .optional()
    .openapi({
      param: {
        name: "estado",
        in: "query",
      },
      description:
        "Filtrar por estado de la reserva (activas, canceladas, finalizadas, pendientes, todas)",
      example: "activas",
    }),
});

export const listarReservasResponseSchema = z.object({
  data: z.array(reservaDetalleSchema),
});

export const cancelarReservaResponseSchema = z.object({
  data: reservaDetalleSchema,
});

export const confirmarReservaParamsSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: {
        name: "id",
        in: "path",
      },
      example: 1,
      description: "ID de la reserva pendiente a confirmar",
    }),
});

export const confirmarReservaResponseSchema = z.object({
  data: reservaDetalleSchema,
});

export const errorSchema = z.object({
  message: z.string(),
});

/** Respuesta de error OpenAPI con el formato `{ message }`. */
export const errorResponse = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

/** Respuesta 401 común a todas las rutas que requieren autenticación. */
export const unauthorizedResponse = errorResponse(
  "No autenticado o token no provisto/inválido",
);

export const finalizarReservaParamsSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: {
        name: "id",
        in: "path",
      },
      example: 1,
      description: "ID de la reserva a finalizar",
    }),
});

export const finalizarReservaBodySchema = z.object({
  observacion: z.string().trim().max(500).optional().openapi({
    example: "Recurso devuelto en perfectas condiciones",
    description:
      "Observación o comentario opcional al momento de la finalización",
  }),
});

export const finalizarReservaResponseSchema = z.object({
  data: reservaDetalleSchema,
});

export type CancelarReservaInput = z.infer<typeof cancelarReservaBodySchema>;
export type ListarReservasQuery = z.infer<typeof listarReservasQuerySchema>;
export type FinalizarReservaInput = z.infer<typeof finalizarReservaBodySchema>;
