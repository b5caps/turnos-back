import "dotenv/config";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import recursosRoutes from "./routes/recursos.routes.js";
import reservasRoutes from "./routes/reservas.routes.js";
import authRoutes from "./routes/auth.routes.js";
import { limpiarHoldsExpirados } from "./services/limpieza.service.js";

const app = new OpenAPIHono();

app.use("/*", cors());
app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.route("/api/recursos", recursosRoutes);
app.route("/api/reservas", reservasRoutes);
app.route("/api/auth", authRoutes);

app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Token JWT obtenido de /api/auth/login",
});

app.doc("/doc", {
  openapi: "3.0.0",
  info: { version: "1.0.0", title: "GREB/SIREB API" },
});

app.get("/docs", swaggerUI({ url: "/doc" }));

// Intervalo de limpieza cada 60 segundos
const INTERVALO_LIMPIEZA_MS = 60 * 1000;
setInterval(() => {
  limpiarHoldsExpirados().catch((err) => {
    console.error("[Limpieza] Error al limpiar holds expirados:", err);
  });
}, INTERVALO_LIMPIEZA_MS);

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
    console.log(`Docs disponibles en http://localhost:${info.port}/docs`);
  },
);
