import { z } from "@hono/zod-openapi";
import { esFechaRealValida } from "../lib/validation.js";

const fechaFeriadoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "El formato de fecha debe ser YYYY-MM-DD")
  .refine(esFechaRealValida, "La fecha ingresada no es una fecha válida");

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

export const feriadoParamsSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: { name: "id", in: "path" },
      example: 1,
    }),
});

export const crearFeriadoSchema = z
  .object({
    fecha: fechaFeriadoSchema.openapi({ example: "2026-05-25" }),
    nombre: z
      .string()
      .trim()
      .min(1, "El nombre del feriado es obligatorio")
      .max(120, "El nombre no puede superar los 120 caracteres")
      .openapi({ example: "Día de la Revolución de Mayo" }),
  })
  .strict();

export const actualizarFeriadoSchema = z
  .object({
    fecha: fechaFeriadoSchema.optional().openapi({ example: "2026-05-26" }),
    nombre: z
      .string()
      .trim()
      .min(1, "El nombre del feriado no puede estar vacío")
      .max(120, "El nombre no puede superar los 120 caracteres")
      .optional()
      .openapi({ example: "Feriado puente turístico" }),
  })
  .strict()
  .refine((data) => data.fecha !== undefined || data.nombre !== undefined, {
    message: "Debe enviar al menos la fecha o el nombre a actualizar",
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

export const feriadoMutationResponseSchema = z.object({
  data: feriadoSchema,
  reservasCanceladas: z.number().int(),
  holdsLiberados: z.number().int(),
});

export type ListarFeriadosQuery = z.infer<typeof listarFeriadosQuerySchema>;
export type CrearFeriadoInput = z.infer<typeof crearFeriadoSchema>;
export type ActualizarFeriadoInput = z.infer<typeof actualizarFeriadoSchema>;
