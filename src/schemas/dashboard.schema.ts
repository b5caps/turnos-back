import { z } from "@hono/zod-openapi";

export const errorSchema = z.object({
  message: z.string().openapi({
    example: "Acceso denegado: se requieren permisos de administrador",
  }),
});

export const dashboardQuerySchema = z.object({
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "El formato de fecha debe ser YYYY-MM-DD")
    .optional()
    .openapi({
      param: {
        name: "fecha",
        in: "query",
      },
      example: "2026-10-20",
      description:
        "Fecha a consultar (formato YYYY-MM-DD). Por defecto la fecha actual del servidor.",
    }),
  limiteCancelaciones: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .openapi({
      param: {
        name: "limiteCancelaciones",
        in: "query",
      },
      example: 5,
      description:
        "Cantidad máxima de cancelaciones recientes a retornar (entre 1 y 20, por defecto 5)",
    }),
});

export const categoriaOcupacionSchema = z.object({
  total: z.number().int().openapi({ example: 8 }),
  ocupadas: z.number().int().openapi({ example: 3 }),
  porcentaje: z.number().openapi({ example: 37.5 }),
});

export const ocupacionActualSchema = z.object({
  totalRecursos: z.number().int().openapi({ example: 20 }),
  recursosOcupados: z.number().int().openapi({ example: 6 }),
  recursosDisponibles: z.number().int().openapi({ example: 14 }),
  porcentajeOcupacion: z.number().openapi({ example: 30.0 }),
  desglose: z.object({
    salas: categoriaOcupacionSchema,
    notebooks: categoriaOcupacionSchema,
  }),
});

export const reservasDelDiaSchema = z.object({
  total: z.number().int().openapi({ example: 15 }),
  activas: z.number().int().openapi({ example: 10 }),
  enCurso: z.number().int().openapi({ example: 4 }),
  finalizadas: z.number().int().openapi({ example: 3 }),
  canceladas: z.number().int().openapi({ example: 2 }),
});

export const cancelacionRecienteSchema = z.object({
  id: z.number().int().openapi({ example: 14 }),
  usuario: z.object({
    id: z.number().int().openapi({ example: 2 }),
    nombre: z.string().openapi({ example: "Juan" }),
    apellido: z.string().openapi({ example: "Pérez" }),
    email: z.string().openapi({ example: "juan@utn.edu.ar" }),
  }),
  recursos: z.array(
    z.object({
      id: z.number().int().openapi({ example: 1 }),
      nombre: z.string().openapi({ example: "Sala Magna" }),
    }),
  ),
  fechaHoraInicio: z.string().openapi({ example: "2026-10-20T14:00:00.000Z" }),
  fechaHoraFin: z.string().openapi({ example: "2026-10-20T16:00:00.000Z" }),
  fechaHoraCancelacion: z
    .string()
    .openapi({ example: "2026-10-20T11:30:00.000Z" }),
  motivoCancelacion: z
    .string()
    .nullable()
    .openapi({ example: "Imprevisto de fuerza mayor" }),
});

export const dashboardResponseSchema = z.object({
  data: z.object({
    fecha: z.string().openapi({ example: "2026-10-20" }),
    reservasDelDia: reservasDelDiaSchema,
    ocupacionActual: ocupacionActualSchema,
    tasaOcupacionDia: z.number().openapi({
      example: 42.5,
      description:
        "Porcentaje de horas-recurso reservadas en el día respecto a la capacidad de apertura",
    }),
    cancelacionesRecientes: z.array(cancelacionRecienteSchema),
  }),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
