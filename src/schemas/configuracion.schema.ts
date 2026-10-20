import { z } from "@hono/zod-openapi";

export const errorSchema = z.object({
  message: z.string().openapi({
    example: "Mensaje descriptivo del error",
  }),
});

export const configuracionResponseSchema = z.object({
  data: z.object({
    id: z.number().int().openapi({ example: 1 }),
    minutosApertura: z.number().int().openapi({
      example: 480,
      description: "Minutos desde la medianoche para apertura (ej. 480 = 08:00)",
    }),
    minutosCierre: z.number().int().openapi({
      example: 1320,
      description: "Minutos desde la medianoche para cierre (ej. 1320 = 22:00)",
    }),
    tiempoMaximoAntelacionDias: z.number().int().openapi({
      example: 30,
      description: "Días máximos hacia el futuro para reservar",
    }),
    duracionMinimaMinutos: z.number().int().openapi({
      example: 30,
      description: "Duración mínima permitida para un turno (minutos)",
    }),
    duracionMaximaMinutos: z.number().int().openapi({
      example: 240,
      description: "Duración máxima permitida para un turno (minutos)",
    }),
    actualizadoEn: z.string().openapi({
      example: "2026-10-20T20:00:00.000Z",
    }),
  }),
});

export const actualizarConfiguracionSchema = z
  .object({
    minutosApertura: z
      .number()
      .int()
      .min(0, "Los minutos de apertura deben ser mayores o iguales a 0")
      .max(1439, "Los minutos de apertura no pueden superar las 23:59")
      .optional()
      .openapi({ example: 480 }),
    minutosCierre: z
      .number()
      .int()
      .min(1, "Los minutos de cierre deben ser mayores a 0")
      .max(1440, "Los minutos de cierre no pueden superar las 24:00")
      .optional()
      .openapi({ example: 1320 }),
    tiempoMaximoAntelacionDias: z
      .number()
      .int()
      .min(1, "La antelación máxima debe ser al menos de 1 día")
      .max(365, "La antelación máxima no puede superar 365 días")
      .optional()
      .openapi({ example: 60 }),
    duracionMinimaMinutos: z
      .number()
      .int()
      .min(15, "La duración mínima debe ser al menos 15 minutos")
      .optional()
      .openapi({ example: 30 }),
    duracionMaximaMinutos: z
      .number()
      .int()
      .min(15, "La duración máxima debe ser al menos 15 minutos")
      .optional()
      .openapi({ example: 240 }),
  })
  .refine(
    (data) => {
      if (
        data.minutosApertura !== undefined &&
        data.minutosCierre !== undefined
      ) {
        return data.minutosApertura < data.minutosCierre;
      }
      return true;
    },
    {
      message: "Los minutos de apertura deben ser menores a los de cierre",
      path: ["minutosApertura"],
    },
  )
  .refine(
    (data) => {
      if (
        data.duracionMinimaMinutos !== undefined &&
        data.duracionMaximaMinutos !== undefined
      ) {
        return data.duracionMinimaMinutos <= data.duracionMaximaMinutos;
      }
      return true;
    },
    {
      message: "La duración mínima no puede superar la duración máxima",
      path: ["duracionMinimaMinutos"],
    },
  );

export type ActualizarConfiguracionInput = z.infer<
  typeof actualizarConfiguracionSchema
>;
