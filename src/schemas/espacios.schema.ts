import { z } from "@hono/zod-openapi";

export const errorSchema = z.object({
  message: z.string().openapi({
    example: "Mensaje descriptivo del error",
  }),
});

export const espacioParamsSchema = z.object({
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
      description: "ID del espacio (sala)",
    }),
});

export const listarEspaciosQuerySchema = z.object({
  activo: z
    .enum(["true", "false", "todos"])
    .optional()
    .openapi({
      param: {
        name: "activo",
        in: "query",
      },
      example: "true",
      description:
        "Filtrar por estado: 'true' (solo activos), 'false' (solo inactivos) o 'todos'",
    }),
});

export const disponibilidadEspacioInputSchema = z
  .object({
    diaSemana: z
      .number()
      .int()
      .min(0, "El día de la semana debe estar entre 0 (domingo) y 6 (sábado)")
      .max(6, "El día de la semana debe estar entre 0 (domingo) y 6 (sábado)")
      .openapi({
        example: 1,
        description: "Día de la semana (0 = Domingo, 1 = Lunes, ..., 6 = Sábado)",
      }),
    minutosInicio: z
      .number()
      .int()
      .min(0, "Los minutos de inicio deben ser mayores o iguales a 0")
      .max(1439, "Los minutos de inicio no pueden superar las 23:59")
      .openapi({
        example: 480,
        description:
          "Minutos desde la medianoche para inicio de la franja (ej. 480 = 08:00)",
      }),
    minutosFin: z
      .number()
      .int()
      .min(1, "Los minutos de fin deben ser mayores a 0")
      .max(1440, "Los minutos de fin no pueden superar las 24:00")
      .openapi({
        example: 1320,
        description:
          "Minutos desde la medianoche para fin de la franja (ej. 1320 = 22:00)",
      }),
  })
  .refine((data) => data.minutosInicio < data.minutosFin, {
    message: "Los minutos de inicio deben ser menores a los de fin",
    path: ["minutosInicio"],
  });

export const disponibilidadEspacioDetalleSchema = z.object({
  id: z.number().int().openapi({ example: 1 }),
  diaSemana: z.number().int().openapi({ example: 1 }),
  minutosInicio: z.number().int().openapi({ example: 480 }),
  minutosFin: z.number().int().openapi({ example: 1320 }),
});

export const crearEspacioSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(100)
    .openapi({
      example: "Aula Magna",
      description: "Nombre del espacio o sala",
    }),
  descripcion: z
    .string()
    .trim()
    .max(500)
    .default("")
    .openapi({
      example: "Espacio para conferencias y actos académicos",
      description: "Descripción detallada del espacio",
    }),
  capacidad: z
    .number()
    .int()
    .positive("La capacidad máxima debe ser mayor a 0")
    .openapi({
      example: 80,
      description: "Capacidad máxima de personas",
    }),
  ubicacion: z
    .string()
    .trim()
    .min(1, "La ubicación es obligatoria")
    .max(100)
    .openapi({
      example: "Pabellón Central - Piso 2",
      description: "Ubicación física dentro del establecimiento",
    }),
  activo: z
    .boolean()
    .optional()
    .default(true)
    .openapi({
      example: true,
      description: "Estado del espacio (activo para reservas o inactivo)",
    }),
  disponibilidades: z
    .array(disponibilidadEspacioInputSchema)
    .optional()
    .openapi({
      description:
        "Franjas horarias de disponibilidad por día. Si se omite, se inicializa de lunes a sábado usando minutosApertura y minutosCierre de la configuración global.",
    }),
});

export const actualizarEspacioSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      example: "Aula Magna Renombrada",
      description: "Nuevo nombre del espacio",
    }),
  descripcion: z
    .string()
    .trim()
    .max(500)
    .optional()
    .openapi({
      example: "Descripción actualizada",
    }),
  capacidad: z
    .number()
    .int()
    .positive()
    .optional()
    .openapi({
      example: 100,
    }),
  ubicacion: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      example: "Pabellón Central - Ala Norte",
    }),
  activo: z
    .boolean()
    .optional()
    .openapi({
      example: false,
      description: "Activar o desactivar lógicamente el espacio",
    }),
  disponibilidades: z
    .array(disponibilidadEspacioInputSchema)
    .optional()
    .openapi({
      description:
        "Si se especifica, actualiza las franjas horarias de disponibilidad del espacio.",
    }),
});

export const espacioDetalleSchema = z.object({
  id: z.number().int().openapi({ example: 1 }),
  nombre: z.string().openapi({ example: "Aula Magna" }),
  descripcion: z
    .string()
    .openapi({ example: "Espacio para conferencias y actos" }),
  capacidad: z.number().int().openapi({ example: 80 }),
  activo: z.boolean().openapi({ example: true }),
  ubicacion: z.string().openapi({ example: "Pabellón Central - Piso 2" }),
  disponibilidades: z.array(disponibilidadEspacioDetalleSchema),
});

export const listarEspaciosResponseSchema = z.object({
  data: z.array(espacioDetalleSchema),
});

export const espacioResponseSchema = z.object({
  data: espacioDetalleSchema,
});

export const eliminarEspacioResponseSchema = z.object({
  message: z.string().openapi({ example: "Espacio eliminado exitosamente." }),
  desactivado: z.boolean().openapi({
    example: false,
    description:
      "True si fue desactivado lógicamente por poseer reservas históricas, False si fue eliminado físicamente",
  }),
  data: espacioDetalleSchema.optional(),
});

export type CrearEspacioInput = z.infer<typeof crearEspacioSchema>;
export type ActualizarEspacioInput = z.infer<typeof actualizarEspacioSchema>;
export type ListarEspaciosQuery = z.infer<typeof listarEspaciosQuerySchema>;
