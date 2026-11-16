import { afterEach, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import {
  actualizarFeriado,
  crearFeriado,
  FeriadoBusinessError,
} from "../src/services/feriados.service.js";
import { prisma } from "../src/lib/prisma.js";
import { reloj } from "../src/lib/reloj.js";

afterEach(() => mock.restoreAll());

describe("POST /api/feriados y PATCH /api/feriados/:id", () => {
  test("POST y PATCH /api/feriados exigen rol ADMIN", async () => {
    const prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-secret-feriados";
    try {
      const tokenUtn = jwt.sign({ rol: "UTN" }, process.env.JWT_SECRET, {
        subject: "10",
        expiresIn: 3600,
      });

      const rPost = await app.request("/api/feriados", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenUtn}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fecha: "2026-12-25", nombre: "Navidad" }),
      });
      assert.equal(rPost.status, 403);

      const rPatch = await app.request("/api/feriados/1", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokenUtn}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nombre: "Navidad editada" }),
      });
      assert.equal(rPatch.status, 403);
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
    }
  });

  test("crearFeriado rechaza fecha pasada y cancela reservas en fecha válida", async () => {
    mock.method(reloj, "ahora", () => new Date("2026-11-16T15:00:00-03:00"));

    await assert.rejects(
      () =>
        crearFeriado(
          { fecha: "2026-11-15", nombre: "Ayer" },
          { id: 1, rol: "ADMIN" },
        ),
      FeriadoBusinessError,
    );

    const origFeriado = Object.getOwnPropertyDescriptor(prisma, "feriado");
    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");
    let cancelada = false;

    Object.defineProperty(prisma, "feriado", {
      configurable: true,
      get: () => ({
        findUnique: async () => null,
      }),
    });

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any) => {
        const tx = {
          $queryRaw: async () => [],
          recurso: { findMany: async () => [{ id: 1 }] },
          feriado: {
            create: async ({ data }: any) => ({
              id: 7,
              ...data,
              fechaCreacion: new Date("2026-11-16T15:00:00-03:00"),
            }),
          },
          reserva: {
            findUnique: async () => ({ recursos: [{ recursoId: 1 }] }),
            findMany: async () => [{ id: 55 }],
            updateMany: async () => {
              cancelada = true;
              return { count: 1 };
            },
          },
          reservaBitacora: { create: async () => ({ id: 1 }) },
          reservaPendiente: { findMany: async () => [] },
        };
        return fn(tx);
      },
    });

    try {
      const res = await crearFeriado(
        { fecha: "2026-12-25", nombre: "Navidad" },
        { id: 1, rol: "ADMIN" },
      );
      assert.equal(res.data.id, 7);
      assert.equal(res.reservasCanceladas, 1);
      assert.equal(cancelada, true);
    } finally {
      if (origFeriado) Object.defineProperty(prisma, "feriado", origFeriado);
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });

  test("actualizarFeriado permite editar solo nombre en feriado pasado pero rechaza mover a fecha pasada", async () => {
    mock.method(reloj, "ahora", () => new Date("2026-11-16T15:00:00-03:00"));

    const origFeriado = Object.getOwnPropertyDescriptor(prisma, "feriado");
    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");

    Object.defineProperty(prisma, "feriado", {
      configurable: true,
      get: () => ({
        findUnique: async () => ({
          id: 3,
          fecha: "2026-05-25",
          nombre: "25 de Mayo",
          creadoPorId: 1,
          fechaCreacion: new Date("2026-01-01T00:00:00Z"),
        }),
      }),
    });

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any) => {
        const tx = {
          feriado: {
            update: async ({ data }: any) => ({
              id: 3,
              fecha: "2026-05-25",
              nombre: data.nombre,
              creadoPorId: 1,
              fechaCreacion: new Date("2026-01-01T00:00:00Z"),
            }),
          },
        };
        return fn(tx);
      },
    });

    try {
      const okNombre = await actualizarFeriado(
        3,
        { nombre: "Día de la Revolución de Mayo" },
        { id: 1, rol: "ADMIN" },
      );
      assert.equal(okNombre.data.nombre, "Día de la Revolución de Mayo");

      await assert.rejects(
        () =>
          actualizarFeriado(
            3,
            { fecha: "2026-11-10" },
            { id: 1, rol: "ADMIN" },
          ),
        FeriadoBusinessError,
      );
    } finally {
      if (origFeriado) Object.defineProperty(prisma, "feriado", origFeriado);
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });
});

describe("POST /api/reservas/:id/checkin", () => {
  test("titular sin tokenQr recibe 403; ADMIN con body vacío hace check-in manual (200)", async () => {
    mock.method(reloj, "ahora", () => new Date("2026-12-01T14:05:00Z"));
    const prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-secret-checkin";
    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any) => {
        const tx = {
          $queryRaw: async () => [],
          reserva: {
            findUnique: async () => ({
              id: 88,
              usuarioId: 10,
              fechaHoraInicio: new Date("2026-12-01T14:00:00Z"),
              fechaHoraFin: new Date("2026-12-01T16:00:00Z"),
              fechaLimiteCheckIn: new Date("2026-12-01T14:15:00Z"),
              fechaHoraConfirmacion: new Date("2026-12-01T10:00:00Z"),
              fechaHoraCancelacion: null,
              tipoCancelacion: null,
              fechaHoraCheckIn: null,
              origenCheckIn: null,
              checkInRegistradoPorId: null,
              fechaHoraCheckOut: null,
              recursos: [{ recursoId: 1 }],
            }),
            update: async ({ data }: any) => ({
              id: 88,
              usuarioId: 10,
              fechaHoraInicio: new Date("2026-12-01T14:00:00Z"),
              fechaHoraFin: new Date("2026-12-01T16:00:00Z"),
              fechaLimiteCheckIn: new Date("2026-12-01T14:15:00Z"),
              fechaHoraConfirmacion: new Date("2026-12-01T10:00:00Z"),
              fechaHoraCancelacion: null,
              tipoCancelacion: null,
              fechaHoraCheckOut: null,
              ...data,
            }),
          },
        };
        return fn(tx);
      },
    });

    try {
      const tokenUtn = jwt.sign({ rol: "UTN" }, process.env.JWT_SECRET, {
        subject: "10",
        expiresIn: 3600,
      });
      const rUtn = await app.request("/api/reservas/88/checkin", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenUtn}` },
      });
      assert.equal(rUtn.status, 403);

      const tokenAdmin = jwt.sign({ rol: "ADMIN" }, process.env.JWT_SECRET, {
        subject: "1",
        expiresIn: 3600,
      });
      const rAdmin = await app.request("/api/reservas/88/checkin", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      });
      assert.equal(rAdmin.status, 200);
      const body = (await rAdmin.json()) as { data: any };
      assert.equal(body.data.origenCheckIn, "ADMIN");
      assert.equal(body.data.estado, "EN_CURSO");
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });

  test("fuera de tolerancia da de baja como LIBERADA_POR_AUSENCIA sin rollback y devuelve 409", async () => {
    mock.method(reloj, "ahora", () => new Date("2026-12-01T14:20:00Z"));
    const prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-secret-checkin-late";
    const origTx = Object.getOwnPropertyDescriptor(prisma, "$transaction");
    let updateData: any = null;

    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: async (fn: any) => {
        const tx = {
          $queryRaw: async () => [],
          reserva: {
            findUnique: async () => ({
              id: 89,
              usuarioId: 10,
              fechaHoraInicio: new Date("2026-12-01T14:00:00Z"),
              fechaHoraFin: new Date("2026-12-01T16:00:00Z"),
              fechaLimiteCheckIn: new Date("2026-12-01T14:15:00Z"),
              fechaHoraConfirmacion: new Date("2026-12-01T10:00:00Z"),
              fechaHoraCancelacion: null,
              tipoCancelacion: null,
              fechaHoraCheckIn: null,
              origenCheckIn: null,
              checkInRegistradoPorId: null,
              fechaHoraCheckOut: null,
              recursos: [{ recursoId: 1 }],
            }),
            update: async ({ data }: any) => {
              updateData = data;
              return {};
            },
          },
        };
        return fn(tx);
      },
    });

    try {
      const tokenAdmin = jwt.sign({ rol: "ADMIN" }, process.env.JWT_SECRET, {
        subject: "1",
        expiresIn: 3600,
      });
      const rLate = await app.request("/api/reservas/89/checkin", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      });
      assert.equal(rLate.status, 409);
      assert.equal(updateData.tipoCancelacion, "AUSENCIA");
      assert.ok(updateData.fechaHoraCancelacion instanceof Date);
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
      if (origTx) Object.defineProperty(prisma, "$transaction", origTx);
    }
  });
});
