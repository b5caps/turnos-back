import { z } from "@hono/zod-openapi";

const SOLO_LETRAS_REGEX = /^[\p{L}\s'’-]+$/u;
const TELEFONO_REGEX = /^\+?[\d\s\-()]{6,20}$/;
const LEGAJO_REGEX = /^[a-zA-Z0-9\-]+$/;

function validarDocumentoPorTipo(
  data: { tipoDocumento: "DNI" | "CUIL"; documento: string },
  ctx: z.RefinementCtx,
) {
  const doc = data.documento.trim();
  if (data.tipoDocumento === "DNI") {
    if (!/^\d{7,8}$/.test(doc)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documento"],
        message: "El DNI debe contener entre 7 y 8 dígitos numéricos",
      });
    }
  } else if (data.tipoDocumento === "CUIL") {
    if (!/^(\d{11}|\d{2}-\d{8}-\d)$/.test(doc)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documento"],
        message: "El CUIL debe tener 11 dígitos (ej: 20123456789 o 20-12345678-9)",
      });
    }
  }
}

const datosComunes = {
  tipoDocumento: z.enum(["DNI", "CUIL"]),
  documento: z
    .string()
    .trim()
    .min(7, "El documento debe tener al menos 7 caracteres")
    .max(13, "El documento no puede superar los 13 caracteres"),
  nombre: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(100, "El nombre no puede superar los 100 caracteres")
    .regex(SOLO_LETRAS_REGEX, "El nombre solo puede contener letras y espacios"),
  apellido: z
    .string()
    .trim()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .max(100, "El apellido no puede superar los 100 caracteres")
    .regex(SOLO_LETRAS_REGEX, "El apellido solo puede contener letras y espacios"),
  email: z
    .email("El formato del email no es válido")
    .trim()
    .max(254, "El email no puede superar los 254 caracteres"),
  telefono: z
    .string()
    .trim()
    .min(6, "El teléfono debe tener al menos 6 caracteres")
    .max(20, "El teléfono no puede superar los 20 caracteres")
    .regex(TELEFONO_REGEX, "El teléfono contiene caracteres inválidos")
    .refine(
      (val) => {
        const digits = val.replace(/\D/g, "");
        return digits.length >= 6 && digits.length <= 15;
      },
      { message: "El teléfono debe contener entre 6 y 15 dígitos" },
    ),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
      message: "La contraseña no puede superar 72 bytes",
    }),
};

const registroUtnSchema = z
  .object({
    ...datosComunes,
    rol: z.literal("UTN"),
    legajo: z
      .string()
      .trim()
      .min(1, "El legajo es requerido")
      .max(20, "El legajo no puede superar los 20 caracteres")
      .regex(LEGAJO_REGEX, "El legajo solo puede contener letras, números y guiones"),
    docente: z.boolean(),
    carrera: z
      .string()
      .trim()
      .min(1, "La carrera no puede estar vacía")
      .max(120, "La carrera no puede superar los 120 caracteres")
      .optional(),
  })
  .strict()
  .superRefine(validarDocumentoPorTipo);

const registroExternoSchema = z
  .object({
    ...datosComunes,
    rol: z.literal("EXTERNO"),
    localidad: z
      .string()
      .trim()
      .min(2, "La localidad debe tener al menos 2 caracteres")
      .max(120, "La localidad no puede superar los 120 caracteres"),
    provincia: z
      .string()
      .trim()
      .min(2, "La provincia debe tener al menos 2 caracteres")
      .max(120, "La provincia no puede superar los 120 caracteres"),
    organizacion: z
      .string()
      .trim()
      .min(2, "La organización debe tener al menos 2 caracteres")
      .max(120, "La organización no puede superar los 120 caracteres"),
  })
  .strict()
  .superRefine(validarDocumentoPorTipo);

export const registroSchema = z.discriminatedUnion("rol", [
  registroUtnSchema,
  registroExternoSchema,
]);

export const loginSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1, "El usuario o legajo es requerido")
      .max(254, "El usuario es demasiado largo")
      .openapi({
        example: "usuario@ejemplo.com",
        description: "Email del usuario o legajo de UTN",
      }),
    password: z.string().min(1, "La contraseña es requerida").max(128),
  })
  .strict();

export type RegistroInput = z.infer<typeof registroSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
