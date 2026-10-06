import type { MiddlewareHandler } from "hono";
import { verificarToken, type TokenPayload } from "../services/auth.service.js";

declare module "hono" {
  interface ContextVariableMap {
    usuario: TokenPayload;
    token: string;
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ message: "Token de autenticación no proporcionado" }, 401);
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return c.json({ message: "Token de autenticación no proporcionado" }, 401);
  }

  try {
    const usuario = verificarToken(token);
    c.set("usuario", usuario);
    c.set("token", token);
    await next();
  } catch (error) {
    const message =
      error instanceof Error && error.message === "Token revocado"
        ? "Token de autenticación revocado"
        : "Token de autenticación inválido o expirado";
    return c.json({ message }, 401);
  }
};
