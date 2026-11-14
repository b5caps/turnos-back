import { z } from "@hono/zod-openapi";

export const errorSchema = z.object({
  message: z.string().openapi({
    example: "Mensaje descriptivo del error",
  }),
});

export const reservaParamsSchema = z.object({
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
      description: "ID de la reserva",
    }),
});

export const cancelarReservaParamsSchema = reservaParamsSchema;

export const cancelarReservaBodySchema = z.object({
  motivoCancelacion: z.string().trim().min(1).max(255).optional().openapi({
    example: "Imprevisto laboral",
    description: "Motivo o justificación de la cancelación",
  }),
});

export const crearReservaSchema = z
  .object({
    usuarioId: z.number().int().positive().optional().openapi({
      example: 2,
      description:
        "ID del usuario titular (solo permitido para administradores)",
    }),
    espacioId: z.number().int().positive().optional().openapi({
      example: 1,
      description: "ID del espacio físico o sala a reservar",
    }),
    notebookId: z.number().int().positive().nullable().optional().openapi({
      example: 4,
      description:
        "ID opcional de la notebook institucional a vincular a la reserva (o null si no se requiere)",
    }),
    recursoIds: z
      .array(z.number().int().positive())
      .optional()
      .openapi({
        example: [1, 4],
        description:
          "Array de IDs de recursos (soporte retroactivo, alternativo a espacioId y notebookId)",
      }),
    fechaHoraInicio: z
      .string()
      .datetime({ offset: true, local: true })
      .openapi({
        example: "2026-10-25T14:00:00.000Z",
      }),
    fechaHoraFin: z.string().datetime({ offset: true, local: true }).openapi({
      example: "2026-10-25T16:00:00.000Z",
    }),
    confirmarInmediato: z.boolean().optional().openapi({
      description:
        "Confirmar inmediatamente sin pasar por reserva pendiente (solo administradores)",
    }),
    observacion: z.string().trim().max(500).optional().openapi({
      example: "Reunión de equipo docente",
    }),
  })
  .refine(
    (data) =>
      data.espacioId !== undefined ||
      (data.recursoIds !== undefined && data.recursoIds.length > 0),
    {
      message:
        "Debe especificar al menos un espacio físico (mediante 'espacioId' o 'recursoIds')",
      path: ["espacioId"],
    },
  );

export const editarReservaSchema = z.object({
  notebookId: z.number().int().positive().nullable().optional().openapi({
    example: 4,
    description:
      "ID de la notebook a vincular o reemplazar, o null para desvincular el equipo de la reserva",
  }),
  observacion: z.string().trim().max(500).nullable().optional().openapi({
    example: "Observación actualizada",
  }),
});

export const recursoDetalleSchema = z.object({
  recursoId: z.number().int().openapi({ example: 1 }),
  recurso: z.object({
    id: z.number().int().openapi({ example: 1 }),
    nombre: z.string().openapi({ example: "Aula Magna" }),
    capacidad: z.number().int().openapi({ example: 80 }),
    activo: z.boolean().optional().openapi({ example: true }),
    sala: z
      .object({
        ubicacion: z.string().openapi({ example: "Pabellón Central - Piso 2" }),
      })
      .nullable()
      .optional(),
    notebook: z
      .object({
        marca: z.string().openapi({ example: "Dell" }),
        modelo: z.string().openapi({ example: "Latitude 3420" }),
        numeroSerie: z.string().openapi({ example: "SN-9823471" }),
      })
      .nullable()
      .optional(),
  }),
});

export const reservaDetalleSchema = z.object({
  id: z.number().int().openapi({ example: 1 }),
  usuarioId: z.number().int().openapi({ example: 2 }),
  usuario: z
    .object({
      id: z.number().int().openapi({ example: 2 }),
      nombre: z.string().openapi({ example: "Juan" }),
      apellido: z.string().openapi({ example: "Pérez" }),
      email: z.string().openapi({ example: "juan.perez@utn.edu.ar" }),
      legajo: z.string().nullable().optional().openapi({ example: "12345" }),
    })
    .optional(),
  fechaHoraInicio: z.string().openapi({ example: "2026-10-25T14:00:00.000Z" }),
  fechaHoraFin: z.string().openapi({ example: "2026-10-25T16:00:00.000Z" }),
  fechaLimiteCheckIn: z
    .string()
    .openapi({ example: "2026-10-25T14:15:00.000Z" }),
  fechaHoraConfirmacion: z.string().nullable().optional(),
  fechaExpiracionHold: z.string().nullable().optional(),
  confirmada: z.boolean().optional(),
  esPendiente: z.boolean().optional(),
  fechaHoraCancelacion: z.string().nullable().openapi({ example: null }),
  motivoCancelacion: z.string().nullable().openapi({ example: null }),
  tipoCancelacion: z.enum(["USUARIO", "ADMINISTRADOR", "AUSENCIA"]).nullable(),
  estado: z.enum([
    "PENDIENTE",
    "CONFIRMADA",
    "EN_CURSO",
    "FINALIZADA",
    "CANCELADA",
    "LIBERADA_POR_AUSENCIA",
  ]),
  origenCheckIn: z.enum(["QR", "ADMIN"]).nullable(),
  checkInRegistradoPorId: z.number().int().nullable(),
  fechaHoraCheckIn: z.string().nullable().optional().openapi({ example: null }),
  fechaHoraCheckOut: z
    .string()
    .nullable()
    .optional()
    .openapi({ example: null }),
  observacion: z
    .string()
    .nullable()
    .openapi({ example: "Reunión de equipo docente" }),
  recursos: z.array(recursoDetalleSchema),
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
    .enum([
      "todas",
      "activas",
      "canceladas",
      "finalizadas",
      "pendientes",
      "liberadas_por_ausencia",
    ])
    .optional()
    .openapi({
      param: {
        name: "estado",
        in: "query",
      },
      description:
        "Filtrar por estado: activas, canceladas (incluye ausencias), liberadas_por_ausencia, finalizadas, pendientes o todas",
      example: "activas",
    }),
});

export const listarReservasResponseSchema = z.object({
  data: z.array(reservaDetalleSchema),
});

export const reservaResponseSchema = z.object({
  data: reservaDetalleSchema,
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

export const notebookAsignacionesQuerySchema = z.object({
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido")
    .optional()
    .openapi({
      param: {
        name: "fecha",
        in: "query",
      },
      example: "2026-10-25",
      description: "Fecha a consultar (YYYY-MM-DD)",
    }),
  momento: z
    .string()
    .datetime({ offset: true, local: true })
    .optional()
    .openapi({
      param: {
        name: "momento",
        in: "query",
      },
      example: "2026-10-25T14:30:00.000Z",
      description:
        "Instante específico a consultar (por defecto el momento actual)",
    }),
});

export const notebookAsignacionItemSchema = z.object({
  notebook: z.object({
    id: z.number().int().openapi({ example: 4 }),
    nombre: z.string().openapi({ example: "Notebook 04" }),
    marca: z.string().openapi({ example: "Dell" }),
    modelo: z.string().openapi({ example: "Latitude 3420" }),
    numeroSerie: z.string().openapi({ example: "SN-9823471" }),
    activo: z.boolean().openapi({ example: true }),
  }),
  estado: z.enum(["DISPONIBLE", "ASIGNADA"]).openapi({ example: "ASIGNADA" }),
  asignacion: z
    .object({
      reservaId: z.number().int().openapi({ example: 12 }),
      fechaHoraInicio: z
        .string()
        .openapi({ example: "2026-10-25T14:00:00.000Z" }),
      fechaHoraFin: z.string().openapi({ example: "2026-10-25T16:00:00.000Z" }),
      espacio: z
        .object({
          id: z.number().int().openapi({ example: 1 }),
          nombre: z.string().openapi({ example: "Aula Magna" }),
          ubicacion: z
            .string()
            .openapi({ example: "Pabellón Central - Piso 2" }),
        })
        .nullable(),
      usuario: z.object({
        id: z.number().int().openapi({ example: 3 }),
        nombre: z.string().openapi({ example: "Carlos" }),
        apellido: z.string().openapi({ example: "Gómez" }),
        email: z.string().openapi({ example: "carlos.gomez@utn.edu.ar" }),
        legajo: z.string().nullable().optional().openapi({ example: "88412" }),
      }),
    })
    .nullable(),
});

export const notebookAsignacionesResponseSchema = z.object({
  data: z.array(notebookAsignacionItemSchema),
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
export type CrearReservaInput = z.infer<typeof crearReservaSchema>;
export type EditarReservaInput = z.infer<typeof editarReservaSchema>;
export type NotebookAsignacionesQuery = z.infer<
  typeof notebookAsignacionesQuerySchema
>;
