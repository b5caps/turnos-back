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
import { prisma, TRANSACCION_OPCIONES } from "../src/lib/prisma.js";
import {
  cancelarReserva,
  confirmarReserva,
  finalizarReserva,
  ReservaConflictError,
  ReservaNotFoundError,
} from "../src/services/reservas.service.js";
import { registrarCheckIn } from "../src/services/asistencia.service.js";

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

    const mockConfig = {
      id: 1,
      minutosApertura: 480,
      minutosCierre: 1320,
      duracionMinimaMinutos: 30,
      duracionMaximaMinutos: 240,
      tiempoMaximoAntelacionDias: 30,
      minutosGraciaCheckIn: 15,
      actualizadoEn: new Date("2026-12-01T00:00:00.000Z"),
    };

    Object.defineProperty(prisma, "configuracion", {
      configurable: true,
      get: () => ({
        findUnique: async () => mockConfig,
        upsert: async () => mockConfig,
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

describe("Transacciones optimizadas con timeout en cancelación, finalización y check-in", () => {
  test("cancelarReserva usa TRANSACCION_OPCIONES, lectura escalar y un único update con bitácora", async () => {
    const ahora = new Date("2026-12-01T10:00:00.000Z");
    mock.method(reloj, "ahora", () => ahora);

    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");
    let txOptions: unknown;
    const findUniqueArgs: any[] = [];
    let updateCalled = 0;
    let findUniqueOrThrowCalled = 0;
    let bitacoraAccion: string | null = null;

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any, options: unknown) => {
        txOptions = options;
        const tx = {
          $queryRaw: async () => [],
          reserva: {
            findUnique: async (args: any) => {
              findUniqueArgs.push(args);
              if (args.select?.recursos) {
                return { recursos: [{ recursoId: 3 }] };
              }
              return {
                usuarioId: 7,
                fechaHoraCancelacion: null,
                fechaHoraCheckIn: null,
                fechaHoraCheckOut: null,
                fechaHoraFin: new Date("2026-12-01T12:00:00.000Z"),
              };
            },
            findUniqueOrThrow: async () => {
              findUniqueOrThrowCalled += 1;
              return {};
            },
            update: async ({ data, include }: any) => {
              updateCalled += 1;
              assert.ok(include?.recursos);
              return {
                id: 50,
                usuarioId: 7,
                creadoPorId: 7,
                canceladoPorId: 7,
                fechaHoraInicio: new Date("2026-12-01T11:00:00.000Z"),
                fechaHoraFin: new Date("2026-12-01T12:00:00.000Z"),
                fechaLimiteCheckIn: new Date("2026-12-01T11:15:00.000Z"),
                fechaHoraConfirmacion: new Date("2026-12-01T09:00:00.000Z"),
                fechaHoraCancelacion: data.fechaHoraCancelacion,
                motivoCancelacion: data.motivoCancelacion,
                tipoCancelacion: data.tipoCancelacion,
                fechaHoraCheckIn: null,
                fechaHoraCheckOut: null,
                observacion: null,
                recursos: [],
              };
            },
          },
          reservaBitacora: {
            create: async ({ data }: any) => {
              bitacoraAccion = data.accion;
              return { id: 1, ...data };
            },
            findMany: async () => [
              {
                id: 1,
                reservaId: 50,
                accion: "CANCELACION",
                actorId: 7,
                actorRol: "UTN",
                actor: null,
                fechaHora: ahora,
                detalle: "Cambio de planes",
              },
            ],
          },
        };
        return fn(tx);
      },
    });

    try {
      const res = await cancelarReserva(
        50,
        { motivoCancelacion: " Cambio de planes " },
        { id: 7, rol: "UTN" },
      );

      assert.deepEqual(txOptions, TRANSACCION_OPCIONES);
      assert.equal(findUniqueArgs.length, 2);
      assert.equal(findUniqueArgs[1].include, undefined);
      assert.ok(findUniqueArgs[1].select);
      assert.equal(updateCalled, 1);
      assert.equal(findUniqueOrThrowCalled, 0);
      assert.equal(bitacoraAccion, "CANCELACION");
      assert.equal(res.canceladoPorId, 7);
      assert.equal(res.canceladoPorRol, "UTN");
      assert.equal(res.motivoCancelacion, "Cambio de planes");
    } finally {
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });

  test("cancelarReserva lanza ReservaNotFoundError si bloquearReserva no encuentra la reserva", async () => {
    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");
    let findUniqueCalls = 0;

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any) => {
        const tx = {
          $queryRaw: async () => [],
          reserva: {
            findUnique: async () => {
              findUniqueCalls += 1;
              return null;
            },
          },
        };
        return fn(tx);
      },
    });

    try {
      await assert.rejects(
        () => cancelarReserva(999, undefined, { id: 7, rol: "UTN" }),
        ReservaNotFoundError,
      );
      assert.equal(findUniqueCalls, 1);
    } finally {
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });

  test("finalizarReserva usa TRANSACCION_OPCIONES y un único update con bitácora", async () => {
    const ahora = new Date("2026-12-01T11:30:00.000Z");
    mock.method(reloj, "ahora", () => ahora);

    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");
    let txOptions: unknown;
    let updateCalled = 0;
    let bitacoraAccion: string | null = null;

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any, options: unknown) => {
        txOptions = options;
        const tx = {
          $queryRaw: async () => [],
          reserva: {
            findUnique: async ({ select }: any) =>
              select?.recursos
                ? { recursos: [{ recursoId: 3 }] }
                : {
                    usuarioId: 7,
                    fechaHoraCancelacion: null,
                    fechaHoraCheckOut: null,
                    fechaHoraCheckIn: new Date("2026-12-01T11:05:00.000Z"),
                    fechaHoraInicio: new Date("2026-12-01T11:00:00.000Z"),
                    fechaHoraFin: new Date("2026-12-01T12:00:00.000Z"),
                  },
            update: async ({ data }: any) => {
              updateCalled += 1;
              return {
                id: 51,
                usuarioId: 7,
                creadoPorId: 7,
                canceladoPorId: null,
                fechaHoraCheckOut: data.fechaHoraCheckOut,
                observacion: data.observacion ?? null,
                recursos: [],
              };
            },
          },
          reservaBitacora: {
            create: async ({ data }: any) => {
              bitacoraAccion = data.accion;
              return { id: 2, ...data };
            },
            findMany: async () => [],
          },
        };
        return fn(tx);
      },
    });

    try {
      const res = await finalizarReserva(
        51,
        { observacion: "Sala ordenada" },
        { id: 7, rol: "UTN" },
      );

      assert.deepEqual(txOptions, TRANSACCION_OPCIONES);
      assert.equal(updateCalled, 1);
      assert.equal(bitacoraAccion, "FINALIZACION");
      assert.equal(res.observacion, "Sala ordenada");
    } finally {
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });

  test("registrarCheckIn pasa TRANSACCION_OPCIONES a prisma.$transaction", async () => {
    const ahora = new Date("2026-12-01T11:05:00.000Z");
    mock.method(reloj, "ahora", () => ahora);

    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");
    let txOptions: unknown;

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any, options: unknown) => {
        txOptions = options;
        const tx = {
          $queryRaw: async () => [],
          reserva: {
            findUnique: async ({ select }: any) =>
              select?.recursos
                ? { recursos: [{ recursoId: 3 }] }
                : {
                    id: 52,
                    usuarioId: 7,
                    fechaHoraConfirmacion: new Date("2026-12-01T09:00:00.000Z"),
                    fechaHoraCancelacion: null,
                    fechaHoraCheckOut: null,
                    fechaHoraCheckIn: null,
                    fechaHoraInicio: new Date("2026-12-01T11:00:00.000Z"),
                    fechaHoraFin: new Date("2026-12-01T12:00:00.000Z"),
                    fechaLimiteCheckIn: new Date("2026-12-01T11:15:00.000Z"),
                    recursos: [{ recursoId: 3 }],
                  },
            update: async ({ data }: any) => ({
              id: 52,
              fechaHoraInicio: new Date("2026-12-01T11:00:00.000Z"),
              fechaHoraFin: new Date("2026-12-01T12:00:00.000Z"),
              fechaLimiteCheckIn: new Date("2026-12-01T11:15:00.000Z"),
              fechaHoraCancelacion: null,
              tipoCancelacion: null,
              fechaHoraCheckOut: null,
              fechaHoraCheckIn: data.fechaHoraCheckIn,
              origenCheckIn: data.origenCheckIn,
              checkInRegistradoPorId: data.checkInRegistradoPorId,
            }),
          },
        };
        return fn(tx);
      },
    });

    try {
      const res = await registrarCheckIn(52, { id: 1, rol: "ADMIN" });
      assert.deepEqual(txOptions, TRANSACCION_OPCIONES);
      assert.equal(res.origenCheckIn, "ADMIN");
    } finally {
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });
});
