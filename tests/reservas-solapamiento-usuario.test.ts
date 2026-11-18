import { afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import { reloj } from "../src/lib/reloj.js";
import {
  crearReserva,
  validarSinSolapamientoUsuario,
} from "../src/services/disponibilidad.service.js";
import {
  confirmarReserva,
  ReservaConflictError,
} from "../src/services/reservas.service.js";

afterEach(() => mock.restoreAll());

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

describe("Validación de solapamiento de reservas por usuario", () => {
  test("validarSinSolapamientoUsuario rechaza si existe una reserva activa solapada y excluye ausencias vencidas", async () => {
    const ahora = new Date("2026-12-01T13:20:00.000Z");
    const inicio = new Date("2026-12-01T14:00:00.000Z");
    const fin = new Date("2026-12-01T16:00:00.000Z");
    let capturedWhere: any = null;

    const fakeTx = {
      reserva: {
        findFirst: async ({ where }: any) => {
          capturedWhere = where;
          return { id: 101 };
        },
      },
      reservaPendiente: {
        findFirst: async () => null,
      },
    } as any;

    await assert.rejects(
      () =>
        validarSinSolapamientoUsuario(fakeTx, {
          usuarioId: 7,
          inicio,
          fin,
          ahora,
        }),
      (err: unknown) =>
        err instanceof ReservaConflictError &&
        err.message.includes("reserva activa"),
    );

    assert.equal(capturedWhere.usuarioId, 7);
    assert.equal(capturedWhere.fechaHoraCancelacion, null);
    assert.deepEqual(capturedWhere.fechaHoraInicio, { lt: fin });
    assert.deepEqual(capturedWhere.fechaHoraFin, { gt: inicio });
    assert.deepEqual(capturedWhere.OR, [
      { fechaHoraCheckOut: null },
      { fechaHoraCheckOut: { gt: inicio } },
    ]);
    assert.equal(capturedWhere.NOT.controlAsistencia, true);
    assert.deepEqual(capturedWhere.NOT.fechaLimiteCheckIn, { lte: ahora });
  });

  test("validarSinSolapamientoUsuario rechaza si existe un hold vigente solapado y excluye el propio hold al confirmar", async () => {
    const ahora = new Date("2026-12-01T13:20:00.000Z");
    const inicio = new Date("2026-12-01T14:00:00.000Z");
    const fin = new Date("2026-12-01T16:00:00.000Z");
    let capturedHoldWhere: any = null;

    const fakeTx = {
      reserva: {
        findFirst: async () => null,
      },
      reservaPendiente: {
        findFirst: async ({ where }: any) => {
          capturedHoldWhere = where;
          return { id: 202 };
        },
      },
    } as any;

    await assert.rejects(
      () =>
        validarSinSolapamientoUsuario(fakeTx, {
          usuarioId: 7,
          inicio,
          fin,
          ahora,
          excluirReservaPendienteId: 55,
        }),
      (err: unknown) =>
        err instanceof ReservaConflictError &&
        err.message.includes("reserva pendiente"),
    );

    assert.equal(capturedHoldWhere.usuarioId, 7);
    assert.deepEqual(capturedHoldWhere.id, { not: 55 });
    assert.deepEqual(capturedHoldWhere.fechaHoraDeseadaInicio, { lt: fin });
    assert.deepEqual(capturedHoldWhere.fechaHoraDeseadaFin, { gt: inicio });
    assert.deepEqual(capturedHoldWhere.fechaHoraSolicitud, {
      gt: new Date("2026-12-01T13:10:00.000Z"),
    });
  });

  test("crearReserva bloquea Usuario antes que Recurso y rechaza cuando ya hay reserva en otra sala", async () => {
    mock.method(reloj, "ahora", () => new Date("2026-12-01T13:00:00.000Z"));

    const origConfig = Object.getOwnPropertyDescriptor(prisma, "configuracion");
    const origRecurso = Object.getOwnPropertyDescriptor(prisma, "recurso");
    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");

    const locks: string[] = [];

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
            id: 2,
            nombre: "Sala B",
            activo: true,
            sala: { id: 2, ubicacion: "Piso 1" },
            notebook: null,
          },
        ],
      }),
    });

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any) => {
        const tx = {
          $queryRaw: async (strings: TemplateStringsArray) => {
            const sql = strings.join("");
            if (sql.includes('"Usuario"')) locks.push("Usuario");
            if (sql.includes('"Recurso"')) locks.push("Recurso");
            return [];
          },
          reserva: {
            findMany: async () => [],
            findFirst: async () => ({ id: 999 }),
          },
          reservaPendiente: {
            findFirst: async () => null,
          },
          feriado: {
            findUnique: async () => null,
          },
          bloqueo: {
            findFirst: async () => null,
          },
          recurso: {
            findMany: async () => [
              {
                id: 2,
                nombre: "Sala B",
                capacidad: 10,
                disponibilidades: [],
                _count: { bloqueos: 0, reservas: 0, reservasPendientes: 0 },
              },
            ],
          },
        };
        return fn(tx);
      },
    });

    try {
      await assert.rejects(
        () =>
          crearReserva(
            {
              usuarioId: 12,
              espacioId: 2,
              fechaHoraInicio: "2026-12-01T14:00:00-03:00",
              fechaHoraFin: "2026-12-01T16:00:00-03:00",
              confirmarInmediato: true,
            },
            { id: 1, rol: "ADMIN" },
          ),
        ReservaConflictError,
      );
      assert.deepEqual(locks, ["Usuario", "Recurso"]);
    } finally {
      if (origConfig) Object.defineProperty(prisma, "configuracion", origConfig);
      if (origRecurso) Object.defineProperty(prisma, "recurso", origRecurso);
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });

  test("confirmarReserva bloquea Usuario antes que Recurso y rechaza si ya tiene otra reserva confirmada solapada", async () => {
    mock.method(reloj, "ahora", () => new Date("2026-12-01T12:05:00.000Z"));

    const origPendiente = Object.getOwnPropertyDescriptor(
      prisma,
      "reservaPendiente",
    );
    const origConfig = Object.getOwnPropertyDescriptor(prisma, "configuracion");
    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");

    const locks: string[] = [];

    Object.defineProperty(prisma, "reservaPendiente", {
      configurable: true,
      get: () => ({
        findUnique: async () => ({
          id: 55,
          usuarioId: 12,
          fechaHoraDeseadaInicio: new Date("2026-12-01T14:00:00.000Z"),
          fechaHoraDeseadaFin: new Date("2026-12-01T16:00:00.000Z"),
          fechaHoraSolicitud: new Date("2026-12-01T12:00:00.000Z"),
        }),
      }),
    });

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
          $queryRaw: async (strings: TemplateStringsArray) => {
            const sql = strings.join("");
            if (sql.includes('"Usuario"')) locks.push("Usuario");
            if (sql.includes('"Recurso"')) locks.push("Recurso");
            return [];
          },
          reservaPendiente: {
            findUnique: async ({ select }: any) =>
              select
                ? { usuarioId: 12, recursos: [{ recursoId: 2 }] }
                : {
                    id: 55,
                    usuarioId: 12,
                    fechaHoraDeseadaInicio: new Date("2026-12-01T14:00:00.000Z"),
                    fechaHoraDeseadaFin: new Date("2026-12-01T16:00:00.000Z"),
                    fechaHoraSolicitud: new Date("2026-12-01T12:00:00.000Z"),
                    recursos: [{ recursoId: 2, recurso: { id: 2 } }],
                  },
            findFirst: async () => null,
          },
          feriado: { findUnique: async () => null },
          bloqueo: { findFirst: async () => null },
          reserva: {
            findFirst: async () => ({ id: 888 }),
          },
        };
        return fn(tx);
      },
    });

    try {
      await assert.rejects(
        () => confirmarReserva(55, { id: 12, rol: "UTN" }),
        ReservaConflictError,
      );
      assert.deepEqual(locks, ["Usuario", "Recurso"]);
    } finally {
      if (origPendiente)
        Object.defineProperty(prisma, "reservaPendiente", origPendiente);
      if (origConfig) Object.defineProperty(prisma, "configuracion", origConfig);
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });
});
