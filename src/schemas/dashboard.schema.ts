import { z } from "@hono/zod-openapi";

export const errorSchema = z.object({
  message: z.string().openapi({
    example: "Acceso denegado: se requieren permisos de administrador",
  }),
});

const periodoSchema = z.enum(["diario", "mensual", "anual"]);

const fechaSchema = z.iso.date(
  "La fecha debe ser válida y tener formato YYYY-MM-DD",
);
const anioSchema = z.coerce.number().int().min(1).max(9999);
const mesSchema = z.coerce.number().int().min(1).max(12);

export const dashboardQuerySchema = z
  .object({
    periodo: periodoSchema.optional().openapi({
      param: { name: "periodo", in: "query" },
      example: "mensual",
      description:
        "diario requiere fecha; mensual requiere anio y mes; anual requiere anio. Sin parámetros se consulta el día actual.",
    }),
    fecha: fechaSchema.optional().openapi({
      param: { name: "fecha", in: "query" },
      example: "2026-10-20",
      description:
        "Fecha requerida exclusivamente para periodo=diario. Los períodos usan la zona horaria del servidor.",
    }),
    anio: anioSchema.optional().openapi({
      param: { name: "anio", in: "query" },
      example: 2026,
      description: "Año requerido para mensual y anual, entre 1 y 9999.",
    }),
    mes: mesSchema.optional().openapi({
      param: { name: "mes", in: "query" },
      example: 10,
      description: "Mes requerido exclusivamente para mensual, entre 1 y 12.",
    }),
  })
  .strict()
  .superRefine((query, ctx) => {
    const error = (campo: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [campo], message });

    if (query.periodo === undefined) {
      if (
        query.fecha !== undefined ||
        query.anio !== undefined ||
        query.mes !== undefined
      ) {
        error("periodo", "Debe indicar periodo cuando envía fecha, anio o mes");
      }
      return;
    }

    if (query.periodo === "diario") {
      if (query.fecha === undefined)
        error("fecha", "fecha es requerida para periodo=diario");
    } else {
      if (query.anio === undefined)
        error("anio", "anio es requerido para periodo=" + query.periodo);
      if (query.fecha !== undefined)
        error("fecha", "fecha sólo corresponde a periodo=diario");
    }
    if (query.periodo === "mensual" && query.mes === undefined) {
      error("mes", "mes es requerido para periodo=mensual");
    }
    if (query.periodo === "diario" && query.anio !== undefined) {
      error("anio", "anio no corresponde a periodo=diario");
    }
    if (query.periodo !== "mensual" && query.mes !== undefined) {
      error("mes", "mes sólo corresponde a periodo=mensual");
    }
  })
  .transform((query) => {
    // superRefine garantiza que los campos de cada período estén presentes.
    if (query.periodo === "mensual") {
      return {
        periodo: "mensual" as const,
        anio: query.anio!,
        mes: query.mes!,
      };
    }
    if (query.periodo === "anual") {
      return { periodo: "anual" as const, anio: query.anio! };
    }
    return { periodo: "diario" as const, fecha: query.fecha };
  });

export const categoriaOcupacionSchema = z.object({
  total: z.number().int().openapi({ example: 8 }),
  ocupadas: z.number().int().openapi({ example: 3 }),
  porcentaje: z.number().openapi({ example: 37.5 }),
});

export const ocupacionActualSchema = z
  .object({
    salas: categoriaOcupacionSchema,
    notebooks: categoriaOcupacionSchema,
  })
  .openapi({
    description:
      "Ocupación del momento actual, independiente del período consultado. Cada recurso se cuenta una sola vez si tiene alguna reserva no cancelada en curso; no requiere check-in.",
  });

export const reservasPeriodoSchema = z.object({
  total: z.number().int().openapi({ example: 100 }),
  pendientes: z.number().int().openapi({
    example: 20,
    description:
      "Reservas no canceladas que todavía no comenzaron; no incluye solicitudes en lista de espera.",
  }),
  enCurso: z.number().int().openapi({ example: 5 }),
  finalizadas: z.number().int().openapi({ example: 65 }),
  canceladas: z.number().int().openapi({ example: 10 }),
});

const dashboardMetricasSchema = z.object({
  reservas: reservasPeriodoSchema.openapi({
    description:
      "Reservas cuyo inicio pertenece al período seleccionado. Los estados se evalúan respecto al momento actual y son excluyentes: total = pendientes + enCurso + finalizadas + canceladas.",
  }),
  ocupacionActual: ocupacionActualSchema,
});

export const dashboardResponseSchema = z.object({
  data: z.discriminatedUnion("periodo", [
    dashboardMetricasSchema.extend({
      periodo: z.literal("diario"),
      fecha: fechaSchema.openapi({ example: "2026-10-20" }),
    }),
    dashboardMetricasSchema.extend({
      periodo: z.literal("mensual"),
      anio: z.number().int().min(1).max(9999).openapi({ example: 2026 }),
      mes: z.number().int().min(1).max(12).openapi({ example: 10 }),
    }),
    dashboardMetricasSchema.extend({
      periodo: z.literal("anual"),
      anio: z.number().int().min(1).max(9999).openapi({ example: 2026 }),
    }),
  ]),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
