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
