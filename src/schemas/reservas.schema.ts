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
  usuarioId: z
    .number()
    .int()
    .positive()
    .optional()
    .openapi({
      example: 2,
      description:
        "ID del usuario titular (opcional; si se envía, se valida que la reserva le pertenezca)",
    }),
  motivoCancelacion: z.string().trim().min(1).max(255).optional().openapi({
    example: "Imprevisto laboral",
    description: "Motivo o justificación de la cancelación",
  }),
});

export const crearReservaBodySchema = z.object({
  usuarioId: z
    .number()
    .int()
    .positive()
    .optional()
    .openapi({
      example: 2,
      description:
        "ID del usuario para quien se crea la reserva (opcional; solo administradores pueden especificar un usuario distinto)",
    }),
  recursoIds: z.array(z.number().int().positive()).min(1).openapi({
    example: [1, 2],
    description: "Lista de IDs de recursos a reservar",
  }),
  fechaHoraInicio: z
    .string()
    .datetime({ offset: true, local: true })
    .openapi({
      example: "2026-10-25T10:00:00.000Z",
      description: "Fecha y hora de inicio de la reserva",
    }),
  fechaHoraFin: z
    .string()
    .datetime({ offset: true, local: true })
    .openapi({
      example: "2026-10-25T12:00:00.000Z",
      description: "Fecha y hora de fin de la reserva",
    }),
  fechaLimiteCheckIn: z
    .string()
    .datetime({ offset: true, local: true })
    .optional()
    .openapi({
      example: "2026-10-25T10:15:00.000Z",
      description: "Fecha y hora límite para realizar check-in",
    }),
  observacion: z
    .string()
    .optional()
    .openapi({
      example: "Uso para reunión de cátedra",
      description: "Observación opcional de la reserva",
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
    .enum(["todas", "activas", "canceladas", "finalizadas"])
    .optional()
    .openapi({
      param: {
        name: "estado",
        in: "query",
      },
      description:
        "Filtrar por estado de la reserva (activas, canceladas, finalizadas, todas)",
      example: "activas",
    }),
});

export const listarReservasResponseSchema = z.object({
  data: z.array(reservaDetalleSchema),
});

export const cancelarReservaResponseSchema = z.object({
  data: reservaDetalleSchema,
});

export const errorSchema = z.object({
  message: z.string(),
});

export type CancelarReservaInput = z.infer<typeof cancelarReservaBodySchema>;
export type ListarReservasQuery = z.infer<typeof listarReservasQuerySchema>;
export type CrearReservaBody = z.infer<typeof crearReservaBodySchema>;

