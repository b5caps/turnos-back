import { after, afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  instanteDelEstablecimiento,
  sumarDiasFecha,
} from "../../src/lib/horarios.js";
import { reloj } from "../../src/lib/reloj.js";

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Definí TEST_DATABASE_URL apuntando a una base PostgreSQL de pruebas migrada",
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = "solapamiento-integration-tests-only";
const { app } = await import("../../src/app.js");
const { prisma } = await import("../../src/lib/prisma.js");

const fecha = sumarDiasFecha(new Date().toISOString().slice(0, 10), 3);
const iso = (hora: number, dia = fecha) =>
  instanteDelEstablecimiento(dia, hora * 60).toISOString();

let adminId: number;
let usuarioId: number;
let otroUsuarioId: number;
let salaAId: number;
let salaBId: number;
let adminToken: string;
let usuarioToken: string;
const recursoIds: number[] = [];

async function request(
  method: string,
  path: string,
  body?: unknown,
  token: string | null = usuarioToken,
) {
  return app.request(path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function reservar(
  espacioId: number,
  inicioHora: number,
  finHora: number,
  confirmarInmediato = false,
  token = usuarioToken,
  titularId?: number,
) {
  return request(
    "POST",
    "/api/reservas",
    {
      espacioId,
      fechaHoraInicio: iso(inicioHora),
      fechaHoraFin: iso(finHora),
      ...(confirmarInmediato ? { confirmarInmediato: true } : {}),
      ...(titularId !== undefined ? { usuarioId: titularId } : {}),
    },
    token,
  );
}

beforeEach(async () => {
  const sufijo = crypto.randomUUID();
  const usuarios = await Promise.all(
    ["ADMIN", "UTN", "UTN"].map((rol, i) =>
      prisma.usuario.create({
        data: {
          rol: rol as "ADMIN" | "UTN",
          nombre: "Prueba",
          apellido: `Solapamiento ${i}`,
          email: `${rol}-${i}-${sufijo}@test.local`,
          tipoDocumento: "DNI",
          documento: `${rol}-${i}-${sufijo}`,
          telefono: "0",
        },
      }),
    ),
  );
  [adminId, usuarioId, otroUsuarioId] = usuarios.map((u) => u.id);
  adminToken = jwt.sign({ rol: "ADMIN" }, process.env.JWT_SECRET!, {
    subject: String(adminId),
  });
  usuarioToken = jwt.sign({ rol: "UTN" }, process.env.JWT_SECRET!, {
    subject: String(usuarioId),
  });

  recursoIds.length = 0;
  for (const nombre of ["Sala Solap A", "Sala Solap B"]) {
    const r = await prisma.recurso.create({
      data: {
        nombre,
        descripcion: "Fixture solapamiento",
        capacidad: 4,
        sala: { create: { ubicacion: "Pruebas" } },
        disponibilidades: {
          create: Array.from({ length: 7 }, (_, diaSemana) => ({
            diaSemana,
            minutosInicio: 480,
            minutosFin: 1320,
          })),
        },
      },
    });
    recursoIds.push(r.id);
  }
  [salaAId, salaBId] = recursoIds;
});

afterEach(async () => {
  mock.restoreAll();
  const reservaIds = (
    await prisma.reserva.findMany({
      where: { usuarioId: { in: [adminId, usuarioId, otroUsuarioId] } },
      select: { id: true },
    })
  ).map((r) => r.id);
  if (reservaIds.length > 0) {
    await prisma.reservaBitacora.deleteMany({
      where: { reservaId: { in: reservaIds } },
    });
    await prisma.reservaRecurso.deleteMany({
      where: { reservaId: { in: reservaIds } },
    });
    await prisma.reserva.deleteMany({
      where: { id: { in: reservaIds } },
    });
  }
  const holdIds = (
    await prisma.reservaPendiente.findMany({
      where: { usuarioId: { in: [adminId, usuarioId, otroUsuarioId] } },
      select: { id: true },
    })
  ).map((h) => h.id);
  if (holdIds.length > 0) {
    await prisma.reservaPendienteRecurso.deleteMany({
      where: { reservaPendienteId: { in: holdIds } },
    });
    await prisma.reservaPendiente.deleteMany({
      where: { id: { in: holdIds } },
    });
  }
  await prisma.disponibilidad.deleteMany({
    where: { recursoId: { in: recursoIds } },
  });
  await prisma.sala.deleteMany({
    where: { recursoId: { in: recursoIds } },
  });
  await prisma.recurso.deleteMany({
    where: { id: { in: recursoIds } },
  });
  await prisma.usuario.deleteMany({
    where: { id: { in: [adminId, usuarioId, otroUsuarioId] } },
  });
});

after(async () => {
  await prisma.$disconnect();
});

describe("Integración: solapamiento de reservas por usuario entre salas", () => {
  test("impide crear hold o reserva en Sala B si el usuario ya tiene reserva o hold solapado en Sala A", async () => {
    const holdA = await reservar(salaAId, 10, 12);
    assert.equal(holdA.status, 201);
    const holdAId = (await holdA.json()).data.id;

    // Otro hold solapado en Sala B -> 409
    const holdB = await reservar(salaBId, 11, 13);
    assert.equal(holdB.status, 409);

    // Confirmar hold A -> 200
    const confA = await request("POST", `/api/reservas/${holdAId}/confirmar`);
    assert.equal(confA.status, 200);

    // Intentar crear hold en Sala B solapado con reserva confirmada -> 409
    const holdBDespues = await reservar(salaBId, 10, 11);
    assert.equal(holdBDespues.status, 409);

    // Incluso un ADMIN creando inmediato para ese usuario -> 409
    const adminRes = await reservar(
      salaBId,
      11,
      12,
      true,
      adminToken,
      usuarioId,
    );
    assert.equal(adminRes.status, 409);
  });

  test("permite reservar Sala B en horario contiguo, o tras cancelar o finalizar anticipadamente en Sala A", async () => {
    const r1 = await reservar(salaAId, 10, 12, true, adminToken, usuarioId);
    assert.equal(r1.status, 201);
    const r1Id = (await r1.json()).data.id;

    // Horario contiguo 12:00-14:00 en Sala B -> 201
    const rContigua = await reservar(salaBId, 12, 14);
    assert.equal(rContigua.status, 201);

    // Cancelar r1 -> habilita 10:00-12:00 en Sala B
    const cancel = await request("PATCH", `/api/reservas/${r1Id}/cancelar`, {});
    assert.equal(cancel.status, 200);

    const rReemplazo = await reservar(salaBId, 10, 12);
    assert.equal(rReemplazo.status, 201);
  });

  test("permite reservar otra sala cuando la reserva previa ya venció por ausencia (sin cron)", async () => {
    const inicioPasado = new Date(Date.now() - 30 * 60 * 1000);
    const finFuturo = new Date(Date.now() + 90 * 60 * 1000);
    const limiteVencido = new Date(Date.now() - 15 * 60 * 1000);

    await prisma.reserva.create({
      data: {
        usuarioId,
        fechaHoraInicio: inicioPasado,
        fechaHoraFin: finFuturo,
        fechaLimiteCheckIn: limiteVencido,
        fechaHoraConfirmacion: new Date(Date.now() - 60 * 60 * 1000),
        controlAsistencia: true,
        recursos: { create: [{ recursoId: salaAId }] },
      },
    });

    const nueva = await request("POST", "/api/reservas", {
      espacioId: salaBId,
      fechaHoraInicio: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      fechaHoraFin: new Date(Date.now() + 65 * 60 * 1000).toISOString(),
    });
    assert.equal(nueva.status, 201);
  });

  test("dos solicitudes concurrentes del mismo usuario a salas distintas en el mismo horario solo permiten una", async () => {
    const [resA, resB] = await Promise.all([
      reservar(salaAId, 14, 16, true, adminToken, usuarioId),
      reservar(salaBId, 14, 16, true, adminToken, usuarioId),
    ]);

    assert.deepEqual([resA.status, resB.status].sort(), [201, 409]);
  });
});
