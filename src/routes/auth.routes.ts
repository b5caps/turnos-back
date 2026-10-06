import { Prisma } from "@prisma/client";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  iniciarSesion,
  registrar,
  revocarToken,
} from "../services/auth.service.js";
import { registroSchema } from "../schemas/auth.schema.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const auth = new OpenAPIHono();

const loginSchema = z
  .object({
    email: z.email().trim(),
    password: z.string().min(1),
  })
  .strict();

const sesionSchema = z.object({
  usuario: z.object({
    id: z.number(),
    rol: z.enum(["UTN", "EXTERNO", "ADMIN"]),
    nombre: z.string(),
    apellido: z.string(),
    email: z.string(),
  }),
  token: z.string(),
  expiresIn: z.number(),
});

const errorSchema = z.object({ message: z.string() });
const logoutResponseSchema = z.object({ message: z.string() });

const registroRoute = createRoute({
  method: "post",
  path: "/registro",
  tags: ["Autenticación"],
  summary: "Registrar usuario UTN o externo",
  request: {
    body: { content: { "application/json": { schema: registroSchema } } },
  },
  responses: {
    201: {
      description: "Usuario registrado",
      content: { "application/json": { schema: sesionSchema } },
    },
    400: {
      description: "Datos inválidos",
      content: { "application/json": { schema: errorSchema } },
    },
    409: {
      description: "Email, documento o legajo ya registrado",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Autenticación"],
  summary: "Iniciar sesión con email y contraseña",
  request: {
    body: { content: { "application/json": { schema: loginSchema } } },
  },
  responses: {
    200: {
      description: "Sesión iniciada",
      content: { "application/json": { schema: sesionSchema } },
    },
    400: {
      description: "Datos inválidos",
      content: { "application/json": { schema: errorSchema } },
    },
    401: {
      description: "Credenciales inválidas",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  tags: ["Autenticación"],
  summary: "Cerrar sesión e invalidar el token actual",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: "Sesión cerrada exitosamente",
      content: { "application/json": { schema: logoutResponseSchema } },
    },
    401: {
      description: "Token no proporcionado, inválido o revocado",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

auth.openapi(registroRoute, async (c) => {
  try {
    return c.json(await registrar(c.req.valid("json")), 201);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return c.json(
        { message: "Email, documento o legajo ya registrado" },
        409,
      );
    }
    throw error;
  }
});

auth.openapi(loginRoute, async (c) => {
  const sesion = await iniciarSesion(
    c.req.valid("json").email,
    c.req.valid("json").password,
  );
  if (!sesion) return c.json({ message: "Credenciales inválidas" }, 401);
  return c.json(sesion, 200);
});

auth.use("/logout", requireAuth);

auth.openapi(logoutRoute, async (c) => {
  const token = c.get("token");
  revocarToken(token);
  return c.json({ message: "Sesión cerrada exitosamente" }, 200);
});

export default auth;
