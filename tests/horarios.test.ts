import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fechaDelEstablecimiento,
  instanteDelEstablecimiento,
  sumarDiasFecha,
} from "../src/lib/horarios.js";
import {
  crearBloqueoSchema,
  listarBloqueosQuerySchema,
} from "../src/schemas/bloqueos.schema.js";

test("los días completos y el cambio de año se calculan en Argentina, independientemente del servidor", () => {
  assert.equal(
    instanteDelEstablecimiento("2026-12-31").toISOString(),
    "2026-12-31T03:00:00.000Z",
  );
  assert.equal(
    instanteDelEstablecimiento(sumarDiasFecha("2026-12-31", 1)).toISOString(),
    "2027-01-01T03:00:00.000Z",
  );
  assert.equal(
    fechaDelEstablecimiento(new Date("2027-01-01T02:59:59Z")),
    "2026-12-31",
  );
});

test("el contrato exige motivo, timestamps con zona y rangos válidos", () => {
  const base = {
    tipo: "FRANJA",
    fechaHoraInicio: "2026-12-01T10:00:00-03:00",
    fechaHoraFin: null,
    motivo: "Mantenimiento",
  };
  assert.equal(crearBloqueoSchema.safeParse(base).success, true);
  for (const variante of [
    { ...base, motivo: "  " },
    { ...base, fechaHoraInicio: "2026-12-01T10:00:00" },
    { ...base, fechaHoraFin: base.fechaHoraInicio },
    { ...base, fechaHoraFin: "2026-12-01T09:00:00-03:00" },
    { ...base, fechaHoraFin: undefined },
    { ...base, campoDesconocido: true },
    {
      tipo: "DIAS_COMPLETOS",
      fechaDesde: "2026-02-30",
      fechaHasta: "2026-03-01",
      motivo: "Feriado",
    },
    {
      tipo: "DIAS_COMPLETOS",
      fechaDesde: "2026-12-02",
      fechaHasta: "2026-12-01",
      motivo: "Feriado",
    },
  ])
    assert.equal(crearBloqueoSchema.safeParse(variante).success, false);
  assert.equal(
    listarBloqueosQuerySchema.safeParse({
      desde: base.fechaHoraInicio,
      hasta: base.fechaHoraInicio,
    }).success,
    false,
  );
});
