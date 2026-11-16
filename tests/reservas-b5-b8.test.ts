import { afterEach, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { registroSchema } from "../src/schemas/auth.schema.js";
import {
  construirResumenAuditoria,
  obtenerAuditoriasReservas,
  registrarEventoReserva,
} from "../src/services/auditoria.service.js";
import { estadoReserva } from "../src/lib/reservas-estado.js";
import { reloj } from "../src/lib/reloj.js";
import { prisma } from "../src/lib/prisma.js";
import {
  confirmarReserva,
  ReservaConflictError,
} from "../src/services/reservas.service.js";

afterEach(() => mock.restoreAll());

describe("B5: Finalización anticipada (check-out)", () => {
  test("estadoReserva marca FINALIZADA cuando hay fechaHoraCheckOut antes de fechaHoraFin", () => {
    mock.method(reloj, "ahora", () => new Date("2026-12-01T13:20:00Z"));
    assert.equal(
      estadoReserva({
        fechaHoraInicio: new Date("2026-12-01T13:00:00Z"),
        fechaHoraFin: new Date("2026-12-01T15:00:00Z"),
        fechaHoraCheckOut: new Date("2026-12-01T13:15:00Z"),
      }),
      "FINALIZADA",
    );
  });
});

describe("B6: Auditoría y bitácora con Prisma", () => {
  test("construirResumenAuditoria combina columnas de Reserva con bitácora", () => {
    const resumen = construirResumenAuditoria(
      [
        {
          accion: "CREACION",
          actorId: 10,
          actorRol: "ADMIN",
          actor: {
            id: 10,
            nombre: "Ana",
            apellido: "Admin",
            email: "ana@utn.edu.ar",
          },
          fechaHora: "2026-12-01T10:00:00.000Z",
          detalle: null,
        },
        {
          accion: "CANCELACION",
          actorId: 10,
          actorRol: "ADMIN",
          actor: {
            id: 10,
            nombre: "Ana",
            apellido: "Admin",
            email: "ana@utn.edu.ar",
          },
          fechaHora: "2026-12-01T11:00:00.000Z",
          detalle: "Mantenimiento",
        },
      ],
      { titularId: 25, creadoPorId: 10, canceladoPorId: 10 },
    );

    assert.equal(resumen.creadoPorId, 10);
    assert.equal(resumen.canceladoPorId, 10);
    assert.equal(resumen.canceladoPorRol, "ADMIN");
    assert.equal(resumen.bitacora.length, 2);
  });

  test("registrarEventoReserva y obtenerAuditoriasReservas operan sobre prisma.reservaBitacora", async () => {
    let createdData: any = null;
    const fakeDb = {
      reservaBitacora: {
        create: async ({ data }: { data: any }) => {
          createdData = data;
          return { id: 1, ...data };
        },
        findMany: async () => [
          {
            id: 1,
            reservaId: 42,
            accion: "CANCELACION",
            actorId: 7,
            actorRol: "ADMIN",
            actor: {
              id: 7,
              nombre: "Admin",
              apellido: "UTN",
              email: "admin@utn.edu.ar",
            },
            fechaHora: new Date("2026-12-01T12:00:00.000Z"),
            detalle: "Cancelada por admin",
          },
        ],
      },
    } as any;

    await registrarEventoReserva(fakeDb, {
      reservaId: 42,
      accion: "CANCELACION",
      actorId: 7,
      actorRol: "ADMIN",
      fechaHora: new Date("2026-12-01T12:00:00.000Z"),
      detalle: "Cancelada por admin",
    });

    assert.equal(createdData.reservaId, 42);
    assert.equal(createdData.accion, "CANCELACION");
    assert.equal(createdData.actorId, 7);

    const mapa = await obtenerAuditoriasReservas([42], fakeDb);
    const eventos = mapa.get(42);
    assert.ok(eventos);
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].actor?.email, "admin@utn.edu.ar");
  });
});

describe("B7: Expiración de hold fuera del rollback", () => {
  test("confirmarReserva confirma el borrado del hold si expira dentro de la transacción", async () => {
    mock.method(reloj, "ahora", () => new Date("2026-12-01T12:15:00.000Z"));

    let holdEliminadoEnTx = false;
    const origReservaPendiente = Object.getOwnPropertyDescriptor(
      prisma,
      "reservaPendiente",
    );
    const origConfiguracion = Object.getOwnPropertyDescriptor(
      prisma,
      "configuracion",
    );
    const origTransaction = Object.getOwnPropertyDescriptor(
      prisma,
      "$transaction",
    );

    Object.defineProperty(prisma, "reservaPendiente", {
      configurable: true,
      get: () => ({
        findUnique: async () => ({
          id: 99,
          usuarioId: 5,
          fechaHoraDeseadaInicio: new Date("2026-12-01T14:00:00.000Z"),
          fechaHoraDeseadaFin: new Date("2026-12-01T15:00:00.000Z"),
          // Todavía vigente en la pre-lectura para simular la carrera dentro de tx
          fechaHoraSolicitud: new Date("2026-12-01T12:06:00.000Z"),
        }),
      }),
    });

    Object.defineProperty(prisma, "configuracion", {
      configurable: true,
      get: () => ({
        upsert: async () => ({
          id: 1,
          minutosApertura: 480,
          minutosCierre: 1320,
          duracionMinimaMinutos: 30,
          duracionMaximaMinutos: 240,
          tiempoMaximoAntelacionDias: 30,
          minutosGraciaCheckIn: 15,
          actualizadoEn: new Date("2026-12-01T00:00:00.000Z"),
        }),
      }),
    });

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any) => {
        const tx = {
          $queryRaw: async () => [],
          reservaPendiente: {
            findUnique: async ({ select }: any) =>
              select
                ? { recursos: [{ recursoId: 1 }] }
                : {
                    id: 99,
                    usuarioId: 5,
                    fechaHoraDeseadaInicio: new Date("2026-12-01T14:00:00.000Z"),
                    fechaHoraDeseadaFin: new Date("2026-12-01T15:00:00.000Z"),
                    fechaHoraSolicitud: new Date("2026-12-01T12:00:00.000Z"),
                    recursos: [{ recursoId: 1, recurso: { id: 1 } }],
                  },
            delete: async () => {
              holdEliminadoEnTx = true;
              return {};
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
      await assert.rejects(
        () => confirmarReserva(99, { id: 5, rol: "UTN" }),
        ReservaConflictError,
      );
      assert.equal(holdEliminadoEnTx, true);
    } finally {
      if (origReservaPendiente)
        Object.defineProperty(prisma, "reservaPendiente", origReservaPendiente);
      if (origConfiguracion)
        Object.defineProperty(prisma, "configuracion", origConfiguracion);
      if (origTransaction)
        Object.defineProperty(prisma, "$transaction", origTransaction);
    }
  });
});

describe("B8: Validación de registro y cuerpo JSON", () => {
  test("registroSchema rechaza documentos y teléfonos inválidos", () => {
    const invalido = registroSchema.safeParse({
      tipoDocumento: "DNI",
      documento: "ABCDEFG",
      nombre: "Juan",
      apellido: "Pérez",
      email: "juan@utn.edu.ar",
      telefono: "abc-no-es-telefono",
      password: "Password123!",
      rol: "UTN",
      legajo: "12345",
      docente: false,
    });
    assert.equal(invalido.success, false);
  });

  test("POST /api/auth/registro sin Content-Type application/json devuelve 400 legible", async () => {
    const res = await app.request("/api/auth/registro", {
      method: "POST",
      body: "no-json",
    });
    assert.equal(res.status, 400);
    const json = (await res.json()) as { message?: string };
    assert.equal(typeof json.message, "string");
    assert.ok(json.message!.length > 0);
  });

  test("POST /api/auth/registro con datos inválidos devuelve 400 con { message } legible", async () => {
    const res = await app.request("/api/auth/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipoDocumento: "DNI",
        documento: "ABCDEFG",
        nombre: "Juan",
        apellido: "Pérez",
        email: "juan@utn.edu.ar",
        telefono: "abc",
        password: "Password123!",
        rol: "UTN",
        legajo: "12345",
        docente: false,
      }),
    });
    assert.equal(res.status, 400);
    const json = (await res.json()) as { message?: string };
    assert.equal(typeof json.message, "string");
    assert.ok(json.message!.includes("DNI") || json.message!.includes("teléfono"));
  });
});
