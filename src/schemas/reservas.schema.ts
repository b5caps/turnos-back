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
  fechaHoraInicio: z.string(),
  fechaHoraFin: z.string(),
  fechaLimiteCheckIn: z.string(),
  fechaHoraCancelacion: z.string().nullable(),
  motivoCancelacion: z.string().nullable(),
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

export const cancelarReservaResponseSchema = z.object({
  data: reservaDetalleSchema,
});

export const errorSchema = z.object({
  message: z.string(),
});

export type CancelarReservaInput = z.infer<typeof cancelarReservaBodySchema>;
