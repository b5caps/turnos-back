import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { calcularFechaLimiteCheckIn } from "../src/services/disponibilidad.service.js";
import { estadoReserva } from "../src/lib/reservas-estado.js";
import { reloj } from "../src/lib/reloj.js";

afterEach(() => mock.restoreAll());

test("la gracia configurable se limita al fin de la reserva", () => {
  const inicio = new Date("2026-12-01T13:00:00Z");
  const fin = new Date("2026-12-01T14:00:00Z");
  assert.equal(
    calcularFechaLimiteCheckIn(inicio, fin, 5).toISOString(),
    "2026-12-01T13:05:00.000Z",
  );
  assert.equal(
    calcularFechaLimiteCheckIn(inicio, fin, 120).toISOString(),
    fin.toISOString(),
  );
});

test("una ausencia conserva su estado incluso después de finalizar el horario original", () => {
  mock.method(reloj, "ahora", () => new Date("2026-12-02T13:00:00Z"));
  assert.equal(
    estadoReserva({
      fechaHoraInicio: new Date("2026-12-01T13:00:00Z"),
      fechaHoraFin: new Date("2026-12-01T14:00:00Z"),
      fechaHoraCancelacion: new Date("2026-12-01T13:15:00Z"),
      tipoCancelacion: "AUSENCIA",
    }),
    "LIBERADA_POR_AUSENCIA",
  );
});
