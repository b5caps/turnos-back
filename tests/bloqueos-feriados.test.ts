import { afterEach, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { crearBloqueoGlobalSchema } from "../src/schemas/bloqueos.schema.js";
import { crearBloqueoGlobal } from "../src/services/bloqueos.service.js";
import { crearReserva } from "../src/services/disponibilidad.service.js";
import { ReservaConflictError } from "../src/services/reservas.service.js";
import { prisma } from "../src/lib/prisma.js";
import { reloj } from "../src/lib/reloj.js";

afterEach(() => mock.restoreAll());

describe("Bloqueos globales y por sala (/api/bloqueos)", () => {
  test("crearBloqueoGlobalSchema acepta formato plano y formato con tipo", () => {
    const plano = crearBloqueoGlobalSchema.safeParse({
      recursoId: null,
      fechaHoraInicio: "2026-12-10T08:00:00-03:00",
      fechaHoraFin: "2026-12-10T18:00:00-03:00",
      motivo: "Fumigación general",
    });
    assert.equal(plano.success, true);

    const conTipo = crearBloqueoGlobalSchema.safeParse({
      recursoId: 3,
      tipo: "DIAS_COMPLETOS",
      fechaDesde: "2026-12-10",
      fechaHasta: "2026-12-11",
      motivo: "Jornada institucional",
    });
    assert.equal(conTipo.success, true);
  });

  test("POST/GET/DELETE /api/bloqueos exigen rol ADMIN", async () => {
    const prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-secret-bloqueos";
    try {
      const tokenUtn = jwt.sign({ rol: "UTN" }, process.env.JWT_SECRET, {
        subject: "10",
        expiresIn: 3600,
      });

      const rGet = await app.request("/api/bloqueos?desde=2026-11-01&hasta=2026-11-30", {
        headers: { Authorization: `Bearer ${tokenUtn}` },
      });
      assert.equal(rGet.status, 403);

      const rPost = await app.request("/api/bloqueos", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenUtn}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recursoId: null,
          fechaHoraInicio: "2026-12-10T08:00:00-03:00",
          fechaHoraFin: "2026-12-10T18:00:00-03:00",
          motivo: "Test",
        }),
      });
      assert.equal(rPost.status, 403);

      const rDel = await app.request("/api/bloqueos/1", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenUtn}` },
      });
      assert.equal(rDel.status, 403);
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
    }
  });

  test("crearBloqueoGlobal cancela reservas afectadas (incluso en curso) y registra bitácora", async () => {
    mock.method(reloj, "ahora", () => new Date("2026-12-10T10:00:00.000Z"));

    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");
    let canceladasUpdateWhere: any = null;
    const bitacorasCreadas: any[] = [];
    let holdsBorrados = false;

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any) => {
        const tx = {
          $queryRaw: async () => [],
          recurso: {
            findMany: async () => [{ id: 1 }, { id: 2 }],
          },
          bloqueo: {
            create: async ({ data }: any) => ({
              id: 50,
              ...data,
              fechaCreacion: new Date("2026-12-10T10:00:00.000Z"),
              recurso: null,
            }),
          },
          reserva: {
            findUnique: async () => ({ recursos: [{ recursoId: 1 }] }),
            findMany: async () => [{ id: 101 }],
            updateMany: async ({ where }: any) => {
              canceladasUpdateWhere = where;
              return { count: 1 };
            },
          },
          reservaBitacora: {
            create: async ({ data }: any) => {
              bitacorasCreadas.push(data);
              return { id: 1, ...data };
            },
          },
          reservaPendiente: {
            findMany: async () => [{ id: 201 }],
            deleteMany: async () => {
              holdsBorrados = true;
              return { count: 1 };
            },
          },
          reservaPendienteRecurso: {
            deleteMany: async () => ({ count: 1 }),
          },
        };
        return fn(tx);
      },
    });

    try {
      const res = await crearBloqueoGlobal(
        {
          recursoId: null,
          fechaHoraInicio: "2026-12-10T09:00:00.000Z",
          fechaHoraFin: "2026-12-10T18:00:00.000Z",
          motivo: "Corte programado",
        },
        { id: 1, rol: "ADMIN" },
      );

      assert.equal(res.bloqueo.id, 50);
      assert.equal(res.reservasCanceladas, 1);
      assert.equal(res.holdsLiberados, 1);
      assert.equal(canceladasUpdateWhere.id, 101);
      assert.equal(bitacorasCreadas.length, 1);
      assert.equal(bitacorasCreadas[0].accion, "CANCELACION");
      assert.equal(holdsBorrados, true);
    } finally {
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });
});

describe("Feriados (GET /api/feriados) y bloqueo de reservas en feriados", () => {
  test("GET /api/feriados?anio=2026 es público y devuelve la lista ordenada", async () => {
    const origFeriado = Object.getOwnPropertyDescriptor(prisma, "feriado");
    Object.defineProperty(prisma, "feriado", {
      configurable: true,
      get: () => ({
        findMany: async () => [
          {
            id: 1,
            fecha: "2026-05-25",
            nombre: "Día de la Revolución de Mayo",
            creadoPorId: 1,
            fechaCreacion: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      }),
    });

    try {
      const res = await app.request("/api/feriados?anio=2026");
      assert.equal(res.status, 200);
      const json = (await res.json()) as { anio: number; data: any[] };
      assert.equal(json.anio, 2026);
      assert.equal(json.data.length, 1);
      assert.equal(json.data[0].fecha, "2026-05-25");
    } finally {
      if (origFeriado) Object.defineProperty(prisma, "feriado", origFeriado);
    }
  });

  test("crearReserva rechaza reservas en fechas feriadas con ReservaConflictError", async () => {
    mock.method(reloj, "ahora", () => new Date("2026-05-20T12:00:00.000Z"));

    const origConfig = Object.getOwnPropertyDescriptor(prisma, "configuracion");
    const origRecurso = Object.getOwnPropertyDescriptor(prisma, "recurso");
    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");

    const mockConfig = {
      id: 1,
      minutosApertura: 480,
      minutosCierre: 1320,
      duracionMinimaMinutos: 30,
      duracionMaximaMinutos: 240,
      tiempoMaximoAntelacionDias: 30,
      minutosGraciaCheckIn: 15,
      actualizadoEn: new Date("2026-01-01T00:00:00.000Z"),
    };

    Object.defineProperty(prisma, "configuracion", {
      configurable: true,
      get: () => ({
        findUnique: async () => mockConfig,
        upsert: async () => mockConfig,
      }),
    });

    Object.defineProperty(prisma, "recurso", {
      configurable: true,
      get: () => ({
        findMany: async () => [
          {
            id: 1,
            nombre: "Aula 1",
            activo: true,
            sala: { id: 1, ubicacion: "PB" },
            notebook: null,
          },
        ],
      }),
    });

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any) => {
        const tx = {
          $queryRaw: async () => [],
          reserva: {
            findMany: async () => [],
          },
          feriado: {
            findUnique: async () => ({
              id: 1,
              fecha: "2026-05-25",
              nombre: "Día de la Revolución de Mayo",
            }),
          },
        };
        return fn(tx);
      },
    });

    try {
      await assert.rejects(
        () =>
          crearReserva({
            usuarioId: 1,
            espacioId: 1,
            fechaHoraInicio: "2026-05-25T14:00:00-03:00",
            fechaHoraFin: "2026-05-25T15:00:00-03:00",
          }),
        (err: unknown) =>
          err instanceof ReservaConflictError &&
          err.message.includes("días feriados"),
      );
    } finally {
      if (origConfig) Object.defineProperty(prisma, "configuracion", origConfig);
      if (origRecurso) Object.defineProperty(prisma, "recurso", origRecurso);
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });
});
