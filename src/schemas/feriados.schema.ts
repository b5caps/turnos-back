import { z } from "@hono/zod-openapi";

export const listarFeriadosQuerySchema = z.object({
  anio: z.coerce
    .number()
    .int()
    .min(2000, "El año debe ser mayor o igual a 2000")
    .max(2100, "El año no puede superar 2100")
    .optional()
    .openapi({
      param: {
        name: "anio",
        in: "query",
      },
      example: 2026,
      description:
        "Año a consultar (por defecto el año vigente en America/Argentina/Buenos_Aires)",
    }),
});

export const feriadoSchema = z.object({
  id: z.number().int().openapi({ example: 1 }),
  fecha: z.string().openapi({ example: "2026-05-25" }),
  nombre: z.string().openapi({ example: "Día de la Revolución de Mayo" }),
  creadoPorId: z.number().int().nullable().optional(),
  fechaCreacion: z.string().openapi({ example: "2026-01-10T12:00:00.000Z" }),
});

export const listarFeriadosResponseSchema = z.object({
  anio: z.number().int().openapi({ example: 2026 }),
  data: z.array(feriadoSchema),
});

export type ListarFeriadosQuery = z.infer<typeof listarFeriadosQuerySchema>;
