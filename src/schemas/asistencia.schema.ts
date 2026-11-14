import { z } from "@hono/zod-openapi";

export const tokenQrSchema = z
  .object({
    tokenQr: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Token QR inválido"),
  })
  .strict();
export const idAsistenciaSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export const asistenciaSchema = z.object({
  id: z.number().int(),
  estado: z.enum([
    "PENDIENTE",
    "CONFIRMADA",
    "EN_CURSO",
    "FINALIZADA",
    "CANCELADA",
    "LIBERADA_POR_AUSENCIA",
  ]),
  fechaLimiteCheckIn: z.string(),
  fechaHoraCheckIn: z.string().nullable(),
  origenCheckIn: z.enum(["QR", "ADMIN"]).nullable(),
  checkInRegistradoPorId: z.number().int().nullable(),
});
export const qrEmitidoSchema = z.object({
  id: z.number().int(),
  recursoId: z.number().int(),
  fechaCreacion: z.string(),
  tokenQr: z.string(),
  url: z.string(),
  qrSvg: z.string(),
});
