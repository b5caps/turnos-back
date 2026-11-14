import { after, afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { reloj } from "../../src/lib/reloj.js";

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Definí TEST_DATABASE_URL para PostgreSQL de pruebas migrado",
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = "asistencia-tests-only";
process.env.CHECK_IN_URL = "https://biblioteca.test/asistencia";
const { app } = await import("../../src/app.js");
const { prisma } = await import("../../src/lib/prisma.js");
const { liberarReservasAusentes, iniciarLiberacionPorAusencia } =
  await import("../../src/services/ausencias.service.js");

const base = new Date();
base.setUTCHours(15, 0, 0, 0);
let ahora = new Date(base);
let adminId: number;
let usuarioId: number;
let otroUsuarioId: number;
let salaId: number;
let otraSalaId: number;
let notebookId: number;
let adminToken: string;
let usuarioToken: string;
let otroToken: string;
const recursoIds: number[] = [];
const usuarioIds: number[] = [];
const sumar = (minutos: number) => new Date(base.getTime() + minutos * 60000);

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
async function emitirQr(id = salaId) {
  const res = await request(
    "POST",
    `/api/espacios/${id}/qr`,
    undefined,
    adminToken,
  );
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).data;
}
async function reserva(
  extra: Record<string, unknown> = {},
  recursos = [salaId, notebookId],
) {
  return prisma.reserva.create({
    data: {
      usuarioId,
      fechaHoraInicio: base,
      fechaHoraFin: sumar(60),
      fechaLimiteCheckIn: sumar(15),
      fechaHoraConfirmacion: sumar(-10),
      ...extra,
      recursos: { create: recursos.map((recursoId) => ({ recursoId })) },
    },
  });
}
const checkIn = (id: number, tokenQr: string, token = usuarioToken) =>
  request("POST", `/api/reservas/${id}/check-in`, { tokenQr }, token);

beforeEach(async () => {
  ahora = new Date(base);
  mock.method(reloj, "ahora", () => new Date(ahora));
  usuarioIds.length = 0;
  recursoIds.length = 0;
  const sufijo = crypto.randomUUID();
  for (const [i, rol] of ["ADMIN", "UTN", "EXTERNO"].entries()) {
    const usuario = await prisma.usuario.create({
      data: {
        rol: rol as "ADMIN" | "UTN" | "EXTERNO",
        nombre: "Prueba",
        apellido: "Asistencia",
        tipoDocumento: "DNI",
        documento: `${sufijo}-${i}`,
        email: `${sufijo}-${i}@test.local`,
        telefono: "0",
      },
    });
    usuarioIds.push(usuario.id);
  }
  [adminId, usuarioId, otroUsuarioId] = usuarioIds;
  [adminToken, usuarioToken, otroToken] = ["ADMIN", "UTN", "EXTERNO"].map(
    (rol, i) =>
      jwt.sign({ rol }, process.env.JWT_SECRET!, {
        subject: String(usuarioIds[i]),
      }),
  );
  for (const nombre of [
    "Sala asistencia",
    "Otra sala",
    "Notebook asistencia",
  ]) {
    const r = await prisma.recurso.create({
      data: {
        nombre,
        capacidad: 1,
        descripcion: "Fixture asistencia",
        ...(nombre.startsWith("Notebook")
          ? {
              notebook: {
                create: { marca: "Test", modelo: "Test", numeroSerie: sufijo },
              },
            }
          : { sala: { create: { ubicacion: "Pruebas" } } }),
        disponibilidades: {
          create: Array.from({ length: 7 }, (_, diaSemana) => ({
            diaSemana,
            minutosInicio: 0,
            minutosFin: 1440,
          })),
        },
      },
    });
    recursoIds.push(r.id);
  }
  [salaId, otraSalaId, notebookId] = recursoIds;
  await prisma.configuracion.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: { minutosGraciaCheckIn: 15 },
  });
});
afterEach(async () => {
  mock.restoreAll();
  const ids = (
    await prisma.reserva.findMany({
      where: { usuarioId: { in: usuarioIds } },
      select: { id: true },
    })
  ).map((r) => r.id);
  const holds = (
    await prisma.reservaPendiente.findMany({
      where: { usuarioId: { in: usuarioIds } },
      select: { id: true },
    })
  ).map((r) => r.id);
  await prisma.$transaction([
    prisma.reservaRecurso.deleteMany({ where: { reservaId: { in: ids } } }),
    prisma.reserva.deleteMany({ where: { id: { in: ids } } }),
    prisma.reservaPendienteRecurso.deleteMany({
      where: { reservaPendienteId: { in: holds } },
    }),
    prisma.reservaPendiente.deleteMany({ where: { id: { in: holds } } }),
    prisma.disponibilidad.deleteMany({
      where: { recursoId: { in: recursoIds } },
    }),
    prisma.bloqueo.deleteMany({ where: { recursoId: { in: recursoIds } } }),
    prisma.sala.deleteMany({ where: { recursoId: { in: recursoIds } } }),
    prisma.notebook.deleteMany({ where: { recursoId: { in: recursoIds } } }),
    prisma.recurso.deleteMany({ where: { id: { in: recursoIds } } }),
    prisma.usuario.deleteMany({ where: { id: { in: usuarioIds } } }),
    prisma.configuracion.update({
      where: { id: 1 },
      data: { minutosGraciaCheckIn: 15 },
    }),
  ]);
});
after(() => prisma.$disconnect());

describe("QR y asistencia", () => {
  test("emite un QR SVG imprimible, almacena solo el hash y exige ADMIN", async () => {
    assert.equal(
      (await request("POST", `/api/espacios/${salaId}/qr`)).status,
      403,
    );
    assert.equal(
      (await request("POST", `/api/espacios/${salaId}/qr`, undefined, null))
        .status,
      401,
    );
    assert.equal(
      (
        await request(
          "POST",
          `/api/espacios/${notebookId}/qr`,
          undefined,
          adminToken,
        )
      ).status,
      404,
    );
    const qr = await emitirQr();
    assert.match(qr.qrSvg, /<svg/);
    assert.equal(new URL(qr.url).origin, "https://biblioteca.test");
    assert.equal(
      new URLSearchParams(new URL(qr.url).hash.slice(1)).get("tokenQr"),
      qr.tokenQr,
    );
    const guardado = await prisma.qrEspacio.findUniqueOrThrow({
      where: { id: qr.id },
    });
    assert.equal(
      guardado.tokenHash,
      createHash("sha256").update(qr.tokenQr).digest("hex"),
    );
    assert.ok(!JSON.stringify(guardado).includes(qr.tokenQr));
  });

  test("reemplazar o revocar el QR invalida los anteriores", async () => {
    const r = await reserva();
    const anterior = await emitirQr();
    const vigente = await emitirQr();
    assert.equal((await checkIn(r.id, anterior.tokenQr)).status, 404);
    assert.equal(
      (
        await request(
          "DELETE",
          `/api/espacios/${salaId}/qr`,
          undefined,
          adminToken,
        )
      ).status,
      204,
    );
    assert.equal((await checkIn(r.id, vigente.tokenQr)).status, 404);
    assert.equal(
      (
        await request(
          "DELETE",
          `/api/espacios/${salaId}/qr`,
          undefined,
          adminToken,
        )
      ).status,
      404,
    );
  });

  test("el QR permite consultar únicamente las reservas propias elegibles", async () => {
    const qr = await emitirQr();
    const propia = await reserva();
    await reserva({ usuarioId: otroUsuarioId });
    await reserva({
      fechaHoraInicio: sumar(30),
      fechaLimiteCheckIn: sumar(45),
    });
    const res = await request("POST", "/api/reservas/check-in/consultar", {
      tokenQr: qr.tokenQr,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(
      (await res.json()).data.reservas.map((r: { id: number }) => r.id),
      [propia.id],
    );
    assert.equal(
      (await prisma.reserva.findUniqueOrThrow({ where: { id: propia.id } }))
        .fechaHoraCheckIn,
      null,
    );
  });

  test("registra asistencia y conserva fecha y autoría ante reintentos", async () => {
    const r = await reserva();
    const qr = await emitirQr();
    const res = await checkIn(r.id, qr.tokenQr);
    assert.equal(res.status, 200, await res.clone().text());
    const data = (await res.json()).data;
    assert.equal(data.fechaHoraCheckIn, base.toISOString());
    assert.equal(data.origenCheckIn, "QR");
    assert.equal(data.checkInRegistradoPorId, usuarioId);
    ahora = sumar(20);
    const repetida = (await (await checkIn(r.id, qr.tokenQr)).json()).data;
    assert.equal(repetida.fechaHoraCheckIn, data.fechaHoraCheckIn);
    assert.equal(await liberarReservasAusentes(), 0);
  });

  test("rechaza otro usuario, otro espacio, QR inválido y fecha enviada por cliente", async () => {
    const r = await reserva();
    const qr = await emitirQr();
    assert.equal((await checkIn(r.id, qr.tokenQr, otroToken)).status, 403);
    assert.equal(
      (await checkIn(r.id, (await emitirQr(otraSalaId)).tokenQr)).status,
      409,
    );
    assert.equal((await checkIn(r.id, "invalido")).status, 400);
    assert.equal((await checkIn(r.id, "A".repeat(43))).status, 404);
    assert.equal(
      (
        await request("POST", `/api/reservas/${r.id}/check-in`, {
          tokenQr: qr.tokenQr,
          fechaHoraCheckIn: sumar(-10).toISOString(),
        })
      ).status,
      400,
    );
  });

  test("solo admite check-in en [inicio, límite), usando el reloj del servidor", async () => {
    const r = await reserva();
    const qr = await emitirQr();
    ahora = sumar(-1);
    assert.equal((await checkIn(r.id, qr.tokenQr)).status, 409);
    ahora = sumar(15);
    assert.equal((await checkIn(r.id, qr.tokenQr)).status, 409);
    ahora = new Date(sumar(15).getTime() - 1);
    assert.equal((await checkIn(r.id, qr.tokenQr)).status, 200);
  });

  test("reservas canceladas, no confirmadas y finalizadas no admiten asistencia", async () => {
    const qr = await emitirQr();
    for (const datos of [
      { fechaHoraCancelacion: base },
      { fechaHoraConfirmacion: null },
      { fechaHoraCheckOut: base },
      { fechaHoraFin: base, fechaLimiteCheckIn: base },
    ]) {
      const r = await reserva(datos);
      assert.equal((await checkIn(r.id, qr.tokenQr)).status, 409);
    }
  });

  test("el administrador puede registrar llegada manual dentro del plazo", async () => {
    const r = await reserva();
    const path = `/api/reservas/${r.id}/check-in/manual`;
    assert.equal((await request("POST", path)).status, 403);
    const response = await request("POST", path, undefined, adminToken);
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.origenCheckIn, "ADMIN");
    assert.equal(data.checkInRegistradoPorId, adminId);
    ahora = sumar(15);
    const otra = await reserva();
    assert.equal(
      (
        await request(
          "POST",
          `/api/reservas/${otra.id}/check-in/manual`,
          undefined,
          adminToken,
        )
      ).status,
      409,
    );
  });

  test("OpenAPI publica QR, check-in, consulta y configuración de gracia", async () => {
    const res = await request("GET", "/doc", undefined, null);
    assert.equal(res.status, 200);
    const doc = await res.json();
    for (const path of [
      "/api/espacios/{id}/qr",
      "/api/reservas/check-in/consultar",
      "/api/reservas/{id}/check-in",
      "/api/reservas/{id}/check-in/manual",
    ])
      assert.ok(doc.paths[path].post);
  });
});

describe("liberación por ausencia", () => {
  test("respeta el límite, libera una sola vez y expone estado y filtro", async () => {
    const r = await reserva();
    ahora = new Date(sumar(15).getTime() - 1);
    assert.equal(await liberarReservasAusentes(), 0);
    ahora = sumar(15);
    assert.equal(await liberarReservasAusentes(), 1);
    assert.equal(await liberarReservasAusentes(), 0);
    const liberada = await prisma.reserva.findUniqueOrThrow({
      where: { id: r.id },
    });
    assert.equal(liberada.tipoCancelacion, "AUSENCIA");
    assert.equal(
      liberada.fechaHoraCancelacion?.toISOString(),
      ahora.toISOString(),
    );
    const res = await request(
      "GET",
      "/api/reservas?estado=liberadas_por_ausencia",
    );
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(
      (await res.json()).data.find((item: { id: number }) => item.id === r.id)
        .estado,
      "LIBERADA_POR_AUSENCIA",
    );
  });

  test("conserva reservas con asistencia, canceladas y sin confirmación", async () => {
    const presentes = await reserva({
      fechaHoraCheckIn: base,
      origenCheckIn: "QR",
      checkInRegistradoPorId: usuarioId,
    });
    const cancelada = await reserva({
      fechaHoraCancelacion: base,
      tipoCancelacion: "USUARIO",
    });
    const noConfirmada = await reserva({ fechaHoraConfirmacion: null });
    const historica = await reserva({ controlAsistencia: false });
    ahora = sumar(16);
    assert.equal(await liberarReservasAusentes(), 0);
    assert.equal(
      (await prisma.reserva.findUniqueOrThrow({ where: { id: presentes.id } }))
        .fechaHoraCancelacion,
      null,
    );
    assert.equal(
      (await prisma.reserva.findUniqueOrThrow({ where: { id: cancelada.id } }))
        .tipoCancelacion,
      "USUARIO",
    );
    assert.equal(
      (
        await prisma.reserva.findUniqueOrThrow({
          where: { id: noConfirmada.id },
        })
      ).fechaHoraCancelacion,
      null,
    );
    assert.equal(
      (await prisma.reserva.findUniqueOrThrow({ where: { id: historica.id } }))
        .fechaHoraCancelacion,
      null,
    );
  });

  test("libera sala y notebook y permite reservar sin esperar al proceso periódico", async () => {
    const anterior = await reserva();
    ahora = sumar(16);
    const fecha = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(base);
    const consultar = async () => {
      const res = await request(
        "GET",
        `/api/recursos/disponibilidad/salas?fecha=${fecha}`,
        undefined,
        null,
      );
      return (await res.json()).recursos.find(
        (r: { id: number }) => r.id === salaId,
      );
    };
    assert.equal(
      (await consultar()).bloques.find(
        (b: { horaInicio: string }) => b.horaInicio === sumar(30).toISOString(),
      ).disponible,
      false,
    );
    const nueva = await request("POST", "/api/reservas", {
      recursoIds: [salaId, notebookId],
      fechaHoraInicio: sumar(30).toISOString(),
      fechaHoraFin: sumar(60).toISOString(),
    });
    assert.equal(nueva.status, 201, await nueva.clone().text());
    assert.equal(
      (await prisma.reserva.findUniqueOrThrow({ where: { id: anterior.id } }))
        .tipoCancelacion,
      "AUSENCIA",
    );
    // El nuevo hold comienza a los 30 minutos: entre 15 y 30 ya no consume la reserva ausente.
    assert.equal(
      (await consultar()).bloques.find(
        (b: { horaInicio: string }) => b.horaInicio === sumar(15).toISOString(),
      ).disponible,
      true,
    );
    const notebooks = await request(
      "GET",
      `/api/recursos/disponibilidad/notebooks?fecha=${fecha}`,
      undefined,
      null,
    );
    assert.equal(
      (await notebooks.json()).recursos
        .find((r: { id: number }) => r.id === notebookId)
        .bloques.find(
          (b: { horaInicio: string }) =>
            b.horaInicio === sumar(15).toISOString(),
        ).disponible,
      true,
    );
  });

  test("la tarea periódica ejecuta liberación sin intervención HTTP", async () => {
    const r = await reserva();
    ahora = sumar(14);
    const detener = iniciarLiberacionPorAusencia(20);
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(
        (await prisma.reserva.findUniqueOrThrow({ where: { id: r.id } }))
          .fechaHoraCancelacion,
        null,
      );
      ahora = sumar(15);
      const limite = Date.now() + 5000;
      while (Date.now() < limite) {
        if (
          (await prisma.reserva.findUniqueOrThrow({ where: { id: r.id } }))
            .tipoCancelacion === "AUSENCIA"
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail("La tarea no liberó la reserva");
    } finally {
      detener();
    }
  });
});

describe("configuración de gracia", () => {
  test("valida permisos y límites y congela el plazo en cada reserva confirmada", async () => {
    assert.equal(
      (
        await request("PATCH", "/api/configuracion", {
          minutosGraciaCheckIn: 20,
        })
      ).status,
      403,
    );
    for (const valor of [0, 121, 1.5])
      assert.equal(
        (
          await request(
            "PATCH",
            "/api/configuracion",
            { minutosGraciaCheckIn: valor },
            adminToken,
          )
        ).status,
        400,
      );
    assert.equal(
      (
        await request(
          "PATCH",
          "/api/configuracion",
          { minutosGraciaCheckIn: 20 },
          adminToken,
        )
      ).status,
      200,
    );
    const futuro = sumar(120);
    const body = {
      espacioId: salaId,
      fechaHoraInicio: futuro.toISOString(),
      fechaHoraFin: sumar(180).toISOString(),
      confirmarInmediato: true,
      fechaLimiteCheckIn: sumar(170).toISOString(),
    };
    const response = await request("POST", "/api/reservas", body, adminToken);
    assert.equal(response.status, 201, await response.clone().text());
    const r = (await response.json()).data;
    assert.equal(r.fechaLimiteCheckIn, sumar(140).toISOString());
    await request(
      "PATCH",
      "/api/configuracion",
      { minutosGraciaCheckIn: 5 },
      adminToken,
    );
    assert.equal(
      (
        await prisma.reserva.findUniqueOrThrow({ where: { id: r.id } })
      ).fechaLimiteCheckIn.toISOString(),
      r.fechaLimiteCheckIn,
    );
    const config = await request(
      "GET",
      "/api/configuracion",
      undefined,
      adminToken,
    );
    assert.equal((await config.json()).data.minutosGraciaCheckIn, 5);
  });

  test("confirmar el hold toma la gracia vigente sin superar el fin del turno", async () => {
    const body = {
      espacioId: salaId,
      fechaHoraInicio: sumar(120).toISOString(),
      fechaHoraFin: sumar(150).toISOString(),
    };
    const holdRes = await request("POST", "/api/reservas", body);
    assert.equal(holdRes.status, 201, await holdRes.clone().text());
    const hold = (await holdRes.json()).data;
    await request(
      "PATCH",
      "/api/configuracion",
      { minutosGraciaCheckIn: 120 },
      adminToken,
    );
    const res = await request("POST", `/api/reservas/${hold.id}/confirmar`);
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(
      (await res.json()).data.fechaLimiteCheckIn,
      sumar(150).toISOString(),
    );
  });
});

async function esperarLocks(cantidad: number) {
  const limite = Date.now() + 8000;
  while (Date.now() < limite) {
    const [{ total }] = await prisma.$queryRaw<
      { total: bigint }[]
    >`SELECT count(*) AS total FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "Recurso"%' AND query LIKE '%FOR UPDATE%'`;
    if (Number(total) >= cantidad) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("No se observaron los locks concurrentes");
}
async function enOrden<T, U>(
  primero: () => Promise<T>,
  segundo: () => Promise<U>,
  antesDeLiberar?: () => void,
): Promise<[T, U]> {
  let a!: Promise<T>;
  let b!: Promise<U>;
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Recurso" WHERE id = ${salaId} FOR UPDATE`;
      a = primero();
      await esperarLocks(1);
      b = segundo();
      await esperarLocks(2);
      antesDeLiberar?.();
    },
    { timeout: 20000 },
  );
  return Promise.all([a, b]);
}

describe("concurrencia de asistencia y ausencia", () => {
  test("dos check-ins simultáneos conservan una única fecha y autoría", async () => {
    const r = await reserva();
    const qr = await emitirQr();
    const respuestas = await enOrden(
      () => checkIn(r.id, qr.tokenQr),
      () =>
        request(
          "POST",
          `/api/reservas/${r.id}/check-in/manual`,
          undefined,
          adminToken,
        ),
    );
    assert.deepEqual(
      respuestas.map((r) => r.status),
      [200, 200],
    );
    const datos = await Promise.all(
      respuestas.map(async (r) => (await r.json()).data),
    );
    assert.deepEqual(datos[0], datos[1]);
    assert.equal(datos[0].origenCheckIn, "QR");
  });

  test("dos procesos de ausencia liberan una única vez", async () => {
    await reserva();
    ahora = sumar(15);
    const resultados = await enOrden(
      liberarReservasAusentes,
      liberarReservasAusentes,
    );
    assert.equal(resultados[0] + resultados[1], 1);
  });

  test("un check-in que esperaba un lock vuelve a verificar el vencimiento", async () => {
    const r = await reserva();
    const qr = await emitirQr();
    ahora = sumar(14);
    const respuestas = await enOrden(
      () => checkIn(r.id, qr.tokenQr),
      () =>
        request(
          "POST",
          `/api/reservas/${r.id}/check-in/manual`,
          undefined,
          adminToken,
        ),
      () => {
        ahora = sumar(15);
      },
    );
    assert.deepEqual(
      respuestas.map((r) => r.status),
      [409, 409],
    );
    assert.equal(await liberarReservasAusentes(), 1);
  });

  test("liberación y check-in al límite no pueden dejar una reserva cancelada y presente", async () => {
    const r = await reserva();
    const qr = await emitirQr();
    ahora = sumar(15);
    const [liberadas, response] = await enOrden(liberarReservasAusentes, () =>
      checkIn(r.id, qr.tokenQr),
    );
    assert.equal(liberadas, 1);
    assert.equal(response.status, 409);
    const actual = await prisma.reserva.findUniqueOrThrow({
      where: { id: r.id },
    });
    assert.equal(actual.tipoCancelacion, "AUSENCIA");
    assert.equal(actual.fechaHoraCheckIn, null);
  });

  test("cancelación manual concurrente con check-in no pisa la asistencia", async () => {
    const r = await reserva();
    const qr = await emitirQr();
    const [entrada, cancelacion] = await enOrden(
      () => checkIn(r.id, qr.tokenQr),
      () => request("PATCH", `/api/reservas/${r.id}/cancelar`, {}),
    );
    assert.equal(entrada.status, 200);
    assert.equal(cancelacion.status, 400);
    assert.equal(
      (await prisma.reserva.findUniqueOrThrow({ where: { id: r.id } }))
        .fechaHoraCancelacion,
      null,
    );
  });
});
