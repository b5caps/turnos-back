import { afterEach, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import {
  obtenerHistorialEntidades,
  registrarCambioEntidad,
} from "../src/services/auditoria.service.js";
import {
  crearReserva,
  DisponibilidadError,
} from "../src/services/disponibilidad.service.js";
import { reloj } from "../src/lib/reloj.js";
import { esFechaRealValida } from "../src/lib/validation.js";

afterEach(() => mock.restoreAll());

describe("B9: EntidadBitacora con Prisma y control de rol en espacios", () => {
  test("registrarCambioEntidad y obtenerHistorialEntidades operan sobre prisma.entidadBitacora", async () => {
    let createdData: any = null;
    const fakeDb = {
      entidadBitacora: {
        create: async ({ data }: { data: any }) => {
          createdData = data;
          return { id: 1, ...data };
        },
        findMany: async () => [
          {
            id: 1,
            entidadTipo: "ESPACIO",
            entidadId: 5,
            accion: "CREACION",
            actorId: 1,
            actorRol: "ADMIN",
            actor: {
              id: 1,
              nombre: "Admin",
              apellido: "UTN",
              email: "admin@utn.edu.ar",
            },
            fechaHora: new Date("2026-11-16T12:00:00.000Z"),
            detalle: "Espacio 'Aula 1' creado",
          },
        ],
      },
    } as any;

    await registrarCambioEntidad(fakeDb, {
      entidadTipo: "ESPACIO",
      entidadId: 5,
      accion: "CREACION",
      actorId: 1,
      actorRol: "ADMIN",
      fechaHora: new Date("2026-11-16T12:00:00.000Z"),
      detalle: "Espacio 'Aula 1' creado",
    });

    assert.equal(createdData.entidadTipo, "ESPACIO");
    assert.equal(createdData.entidadId, 5);
    assert.equal(createdData.accion, "CREACION");

    const mapa = await obtenerHistorialEntidades("ESPACIO", [5], fakeDb);
    const historial = mapa.get(5);
    assert.ok(historial);
    assert.equal(historial.length, 1);
    assert.equal(historial[0].actor?.email, "admin@utn.edu.ar");
  });

  test("GET /api/espacios deniega acceso (403) a usuarios comunes", async () => {
    const prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-secret-b9";
    try {
      const tokenUtn = jwt.sign({ rol: "UTN" }, process.env.JWT_SECRET, {
        subject: "42",
        expiresIn: 3600,
      });
      const res = await app.request("/api/espacios", {
        headers: { Authorization: `Bearer ${tokenUtn}` },
      });
      assert.equal(res.status, 403);
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
    }
  });
});

describe("B10: Validación de fechas en dashboard", () => {
  test("esFechaRealValida rechaza fechas imposibles como 2026-13-45 y 2026-02-30", () => {
    assert.equal(esFechaRealValida("2026-13-45"), false);
    assert.equal(esFechaRealValida("2026-02-30"), false);
    assert.equal(esFechaRealValida("2026-11-16"), true);
  });

  test("GET /api/dashboard con fecha imposible devuelve 400 legible", async () => {
    const prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-secret-b10";
    try {
      const tokenAdmin = jwt.sign({ rol: "ADMIN" }, process.env.JWT_SECRET, {
        subject: "1",
        expiresIn: 3600,
      });
      const res = await app.request("/api/dashboard?fecha=2026-02-30", {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      });
      assert.equal(res.status, 400);
      const json = (await res.json()) as { message?: string };
      assert.equal(typeof json.message, "string");
      assert.ok(json.message!.length > 0);
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
    }
  });
});

describe("B11: Rechazo de reservas en el pasado", () => {
  test("crearReserva rechaza horarios pasados con DisponibilidadError", async () => {
    mock.method(reloj, "ahora", () => new Date("2026-11-16T15:00:00.000Z"));

    await assert.rejects(
      () =>
        crearReserva({
          usuarioId: 1,
          espacioId: 1,
          fechaHoraInicio: "2026-09-15T10:00:00.000Z",
          fechaHoraFin: "2026-09-15T11:00:00.000Z",
        }),
      (err: unknown) =>
        err instanceof DisponibilidadError &&
        err.message === "No se pueden reservar horarios pasados",
    );
  });
});
