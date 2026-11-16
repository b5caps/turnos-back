import type { MiddlewareHandler } from "hono";
import type { Hook } from "@hono/zod-openapi";

/**
 * Hook global para OpenAPIHono que formatea errores de validación de Zod
 * en el formato uniforme `{ message }` con estado HTTP 400.
 */
export const validationHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) {
    const mensajes = result.error.issues.map((issue: any) => {
      const ruta =
        Array.isArray(issue.path) && issue.path.length > 0
          ? `${issue.path.join(".")}: `
          : "";
      return `${ruta}${issue.message}`;
    });
    return c.json(
      {
        message:
          mensajes.length > 0
            ? mensajes.join("; ")
            : "Los datos enviados no son válidos",
      },
      400,
    );
  }
};

/**
 * Middleware que exige Content-Type application/json y un cuerpo JSON objeto válido.
 */
export const requireJsonBody: MiddlewareHandler = async (c, next) => {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return c.json(
      {
        message:
          "El encabezado Content-Type debe ser application/json y contener un cuerpo JSON válido",
      },
      400,
    );
  }

  try {
    const parsed = await c.req.raw.clone().json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return c.json(
        { message: "El cuerpo de la solicitud debe ser un objeto JSON válido" },
        400,
      );
    }
  } catch {
    return c.json(
      { message: "El cuerpo de la solicitud no contiene un JSON válido" },
      400,
    );
  }

  await next();
};

