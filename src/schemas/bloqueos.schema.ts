import { z } from "@hono/zod-openapi";

const instante = z.iso.datetime({ offset: true });
const motivo = z.string().trim().min(1).max(255);

export const crearBloqueoSchema = z
  .discriminatedUnion("tipo", [
    z
      .object({
        tipo: z.literal("FRANJA"),
        fechaHoraInicio: instante,
        fechaHoraFin: instante.nullable(),
        motivo,
      })
      .strict()
      .refine(
        (v) =>
          v.fechaHoraFin === null ||
          new Date(v.fechaHoraFin) > new Date(v.fechaHoraInicio),
        {
          message: "El fin debe ser posterior al inicio",
          path: ["fechaHoraFin"],
        },
      ),
    z
      .object({
        tipo: z.literal("DIAS_COMPLETOS"),
        fechaDesde: z.iso.date(),
        fechaHasta: z.iso.date(),
        motivo,
      })
      .strict()
      .refine((v) => v.fechaHasta >= v.fechaDesde, {
        message: "La fecha final no puede ser anterior a la inicial",
        path: ["fechaHasta"],
      }),
  ])
  .openapi("CrearBloqueo");

export const espacioBloqueoParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const eliminarBloqueoParamsSchema = espacioBloqueoParamsSchema.extend({
  bloqueoId: z.coerce.number().int().positive(),
});

export const listarBloqueosQuerySchema = z
  .object({
    desde: instante.optional(),
    hasta: instante.optional(),
  })
  .refine(
    (v) => !v.desde || !v.hasta || new Date(v.hasta) > new Date(v.desde),
    {
      message: "Hasta debe ser posterior a desde",
      path: ["hasta"],
    },
  );

export const bloqueoSchema = z.object({
  id: z.number().int(),
  recursoId: z.number().int(),
  fechaHoraInicio: z.string(),
  fechaHoraFin: z.string().nullable(),
  motivo: z.string(),
  fechaCreacion: z.string(),
  creadoPorId: z.number().int().nullable(),
});

export type CrearBloqueoInput = z.infer<typeof crearBloqueoSchema>;
export type ListarBloqueosQuery = z.infer<typeof listarBloqueosQuerySchema>;
