import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { limpiarHoldsExpirados } from "./services/limpieza.service.js";

setInterval(() => {
  limpiarHoldsExpirados().catch((err) => {
    console.error("[Limpieza] Error al limpiar holds expirados:", err);
  });
}, 60 * 1000);

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`);
  console.log(`Docs disponibles en http://localhost:${info.port}/docs`);
});
