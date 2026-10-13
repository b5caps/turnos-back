import { z } from "@hono/zod-openapi";

const datosComunes = {
  tipoDocumento: z.enum(["DNI", "CUIL"]),
  documento: z.string().trim().min(1),
  nombre: z.string().trim().min(1),
  apellido: z.string().trim().min(1),
  email: z.email().trim(),
  telefono: z.string().trim().min(1),
  password: z
    .string()
    .min(8)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
      message: "La contraseña no puede superar 72 bytes",
    }),
};

export const registroSchema = z
  .object({
    tipoDocumento: z.enum(["DNI", "CUIL"]),
    documento: z.string().trim().min(1),
    nombre: z.string().trim().min(1),
    apellido: z.string().trim().min(1),
    email: z.email().trim(),
    telefono: z.string().trim().min(1),
    password: z
      .string()
      .min(8)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
        message: "La contraseña no puede superar 72 bytes",
      }),
    localidad: z.string().trim().min(1),
    provincia: z.string().trim().min(1),
    organizacion: z.string().trim().min(1),
    rol: z.literal("EXTERNO").optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    username: z
      .string()
      .trim()
      .optional()
      .openapi({
        example: "usuario@ejemplo.com",
        description: "Email del usuario externo o legajo/email de UTN",
      }),
    email: z
      .string()
      .trim()
      .optional()
      .openapi({
        example: "usuario@ejemplo.com",
        description: "Email del usuario externo o de UTN",
      }),
    password: z.string().min(1),
  })
  .strict();

export type RegistroInput = z.infer<typeof registroSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

