import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  instanteDelEstablecimiento,
  sumarDiasFecha,
} from "../../src/lib/horarios.js";

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Definí TEST_DATABASE_URL apuntando a una base PostgreSQL de pruebas migrada",
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = "bloqueos-integration-tests-only";
const { app } = await import("../../src/app.js");
const { prisma } = await import("../../src/lib/prisma.js");

// Fecha futura dentro de la antelación permitida y sin depender de TZ del proceso.
const fecha = sumarDiasFecha(new Date().toISOString().slice(0, 10), 3);
const iso = (hora: number, dia = fecha) =>
  instanteDelEstablecimiento(dia, hora * 60).toISOString();
let adminId: number;
let usuarioId: number;
let espacioId: number;
let otroEspacioId: number;
let notebookId: number;
let adminToken: string;
let usuarioToken: string;
const ids: number[] = [];

async function request(
  method: string,
  path: string,
  body?: unknown,
  token: string | null = adminToken,
) {
  return app.request(path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const ruta = (id = espacioId) => `/api/espacios/${id}/bloqueos`;
const franja = (inicio = 10, fin: number | null = 12) => ({
  tipo: "FRANJA",
  fechaHoraInicio: iso(inicio),
  fechaHoraFin: fin === null ? null : iso(fin),
  motivo: "Mantenimiento",
});
async function bloquear(body = franja(), id = espacioId) {
  const response = await request("POST", ruta(id), body);
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).data;
}
async function reservar(
  inicio = 10,
  fin = 11,
  inmediato = false,
  id = espacioId,
) {
  return request(
    "POST",
    "/api/reservas",
    {
      espacioId: id,
      fechaHoraInicio: iso(inicio),
      fechaHoraFin: iso(fin),
      confirmarInmediato: inmediato,
    },
    inmediato ? adminToken : usuarioToken,
  );
}
async function disponibilidad() {
  const response = await request(
    "GET",
    `/api/recursos/disponibilidad/salas?fecha=${fecha}`,
    undefined,
    null,
  );
  assert.equal(response.status, 200);
  return (await response.json()).recursos.find(
    (r: { id: number }) => r.id === espacioId,
  );
}

beforeEach(async () => {
  const sufijo = crypto.randomUUID();
  const usuarios = await Promise.all(
    ["ADMIN", "UTN"].map((rol) =>
      prisma.usuario.create({
        data: {
          rol: rol as "ADMIN" | "UTN",
          nombre: "Prueba",
          apellido: "Bloqueos",
          email: `${rol}-${sufijo}@test.local`,
          tipoDocumento: "DNI",
          documento: `${rol}-${sufijo}`,
          telefono: "0",
        },
      }),
    ),
  );
  [adminId, usuarioId] = usuarios.map((u) => u.id);
  adminToken = jwt.sign({ rol: "ADMIN" }, process.env.JWT_SECRET!, {
    subject: String(adminId),
  });
  usuarioToken = jwt.sign({ rol: "UTN" }, process.env.JWT_SECRET!, {
    subject: String(usuarioId),
  });
  ids.length = 0;
  for (const nombre of ["Espacio A", "Espacio B", "Notebook"]) {
    const r = await prisma.recurso.create({
      data: {
        nombre,
        descripcion: "Fixture bloqueos",
        capacidad: 4,
        ...(nombre === "Notebook"
          ? {
              notebook: {
                create: { marca: "Test", modelo: "Test", numeroSerie: sufijo },
              },
            }
          : { sala: { create: { ubicacion: "Pruebas" } } }),
        disponibilidades: {
          create: Array.from({ length: 7 }, (_, diaSemana) => ({
            diaSemana,
            minutosInicio: 480,
            minutosFin: 1320,
          })),
        },
      },
    });
    ids.push(r.id);
  }
  [espacioId, otroEspacioId, notebookId] = ids;
});

afterEach(async () => {
  const reservaIds = (
    await prisma.reserva.findMany({
      where: { usuarioId: { in: [adminId, usuarioId] } },
      select: { id: true },
    })
  ).map((r) => r.id);
  const pendientesIds = (
    await prisma.reservaPendiente.findMany({
      where: { usuarioId: { in: [adminId, usuarioId] } },
      select: { id: true },
    })
  ).map((r) => r.id);
  await prisma.$transaction([
    prisma.reservaRecurso.deleteMany({
      where: { reservaId: { in: reservaIds } },
    }),
    prisma.reserva.deleteMany({ where: { id: { in: reservaIds } } }),
    prisma.reservaPendienteRecurso.deleteMany({
      where: { reservaPendienteId: { in: pendientesIds } },
    }),
    prisma.reservaPendiente.deleteMany({
      where: { id: { in: pendientesIds } },
    }),
    prisma.bloqueo.deleteMany({ where: { recursoId: { in: ids } } }),
    prisma.disponibilidad.deleteMany({ where: { recursoId: { in: ids } } }),
    prisma.sala.deleteMany({ where: { recursoId: { in: ids } } }),
    prisma.notebook.deleteMany({ where: { recursoId: { in: ids } } }),
    prisma.recurso.deleteMany({ where: { id: { in: ids } } }),
    prisma.usuario.deleteMany({ where: { id: { in: [adminId, usuarioId] } } }),
  ]);
});
after(() => prisma.$disconnect());

describe("gestión administrativa y reservas", () => {
  test("OpenAPI publica los tres endpoints y las dos modalidades de creación", async () => {
    const response = await request("GET", "/doc", undefined, null);
    assert.equal(response.status, 200, await response.clone().text());
    const doc = await response.json();
    const path = doc.paths["/api/espacios/{id}/bloqueos"];
    assert.ok(path.post);
    assert.ok(path.get);
    assert.ok(doc.paths["/api/espacios/{id}/bloqueos/{bloqueoId}"].delete);
    assert.equal(doc.components.schemas.CrearBloqueo.oneOf.length, 2);
  });

  test("solo ADMIN puede crear, listar y eliminar; sin token responde 401", async () => {
    const bloqueo = await bloquear();
    for (const token of [usuarioToken, null]) {
      for (const [method, path, body] of [
        ["POST", ruta(), franja()],
        ["GET", ruta(), undefined],
        ["DELETE", `${ruta()}/${bloqueo.id}`, undefined],
      ] as const) {
        assert.equal(
          (await request(method, path, body, token)).status,
          token ? 403 : 401,
        );
      }
    }
    assert.equal(
      (await prisma.bloqueo.findUnique({ where: { id: bloqueo.id } }))
        ?.creadoPorId,
      adminId,
    );
  });

  test("valida datos, espacios y pertenencia del bloqueo", async () => {
    assert.equal(
      (await request("POST", ruta(), { ...franja(), motivo: " " })).status,
      400,
    );
    assert.equal(
      (await request("POST", ruta(), { ...franja(), fechaHoraFin: iso(9) }))
        .status,
      400,
    );
    assert.equal(
      (
        await request("POST", ruta(), {
          ...franja(),
          fechaHoraInicio: `${fecha}T10:00:00`,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("POST", ruta(notebookId), franja())).status,
      404,
    );
    assert.equal((await request("GET", ruta(2147483647))).status, 404);
    const bloqueo = await bloquear();
    assert.equal(
      (await request("DELETE", `${ruta(otroEspacioId)}/${bloqueo.id}`)).status,
      404,
    );
    assert.equal(
      (await request("DELETE", `${ruta()}/${bloqueo.id}`)).status,
      204,
    );
    assert.equal(
      (await request("DELETE", `${ruta()}/${bloqueo.id}`)).status,
      404,
    );
  });

  test("cualquier solapamiento impide holds y reservas inmediatas, incluso con capacidad libre", async () => {
    await bloquear();
    for (const [inicio, fin] of [
      [9, 11],
      [10, 11],
      [11, 13],
      [9, 13],
      [10, 12],
    ]) {
      assert.equal((await reservar(inicio, fin)).status, 409);
      assert.equal((await reservar(inicio, fin, true)).status, 409);
    }
    assert.equal((await reservar(10, 11, false, otroEspacioId)).status, 201);
  });

  test("los extremos son exclusivos: se puede finalizar al inicio o comenzar al fin del bloqueo", async () => {
    await bloquear();
    assert.equal((await reservar(9, 10)).status, 201);
    assert.equal((await reservar(12, 13)).status, 201);
  });

  test("bloqueo indefinido: afecta fechas futuras y el listado filtra por solapamiento", async () => {
    const bloqueo = await bloquear(franja(10, null));
    assert.equal(bloqueo.fechaHoraFin, null);
    assert.equal((await reservar(12, 13)).status, 409);
    const query = new URLSearchParams({
      desde: iso(10, sumarDiasFecha(fecha, 2)),
      hasta: iso(12, sumarDiasFecha(fecha, 2)),
    });
    const lista = await request("GET", `${ruta()}?${query}`);
    assert.deepEqual(
      (await lista.json()).data.map((b: { id: number }) => b.id),
      [bloqueo.id],
    );
    const sinSolapamiento = await request(
      "GET",
      `${ruta()}?${new URLSearchParams({ hasta: iso(10) })}`,
    );
    assert.equal((await sinSolapamiento.json()).data.length, 0);
  });

  test("días completos incluyen ambas fechas civiles y bloquean los horarios de la jornada", async () => {
    const hasta = sumarDiasFecha(fecha, 1);
    const response = await request("POST", ruta(), {
      tipo: "DIAS_COMPLETOS",
      fechaDesde: fecha,
      fechaHasta: hasta,
      motivo: "Feriado",
    });
    assert.equal(response.status, 201);
    const { data } = await response.json();
    assert.equal(data.fechaHoraInicio, `${fecha}T03:00:00.000Z`);
    assert.equal(
      data.fechaHoraFin,
      `${sumarDiasFecha(hasta, 1)}T03:00:00.000Z`,
    );
    assert.equal((await reservar(8, 9)).status, 409);
    assert.equal((await reservar(21, 22)).status, 409);
    const siguiente = await request(
      "POST",
      "/api/reservas",
      {
        espacioId,
        fechaHoraInicio: iso(10, hasta),
        fechaHoraFin: iso(11, hasta),
      },
      usuarioToken,
    );
    assert.equal(siguiente.status, 409);
    const posterior = sumarDiasFecha(hasta, 1);
    assert.equal(
      (
        await request(
          "POST",
          "/api/reservas",
          {
            espacioId,
            fechaHoraInicio: iso(10, posterior),
            fechaHoraFin: iso(11, posterior),
          },
          usuarioToken,
        )
      ).status,
      201,
    );
  });

  test("disponibilidad muestra bloqueado y eliminarlo libera inmediatamente la restricción", async () => {
    const bloqueo = await bloquear();
    const recurso = await disponibilidad();
    const bloque = recurso.bloques.find(
      (b: { horaInicio: string }) => b.horaInicio === iso(10),
    );
    assert.equal(bloque.disponible, false);
    assert.equal(bloque.motivoNoDisponible, "bloqueado");
    assert.equal(
      (await request("DELETE", `${ruta()}/${bloqueo.id}`)).status,
      204,
    );
    const libre = (await disponibilidad()).bloques.find(
      (b: { horaInicio: string }) => b.horaInicio === iso(10),
    );
    assert.equal(libre.disponible, true);
    assert.equal((await reservar()).status, 201);
  });

  test("eliminar un bloqueo no anula otros bloqueos superpuestos", async () => {
    const primero = await bloquear();
    await bloquear(franja(11, 13));
    await request("DELETE", `${ruta()}/${primero.id}`);
    assert.equal((await reservar(11, 12)).status, 409);
    assert.equal((await reservar(10, 11)).status, 201);
  });

  test("eliminar un bloqueo conserva la restricción por capacidad de reservas existentes", async () => {
    await prisma.recurso.update({
      where: { id: espacioId },
      data: { capacidad: 1 },
    });
    assert.equal((await reservar(10, 11, true)).status, 201);
    const bloqueo = await bloquear();
    assert.equal(
      (await request("DELETE", `${ruta()}/${bloqueo.id}`)).status,
      204,
    );
    const bloque = (await disponibilidad()).bloques.find(
      (b: { horaInicio: string }) => b.horaInicio === iso(10),
    );
    assert.equal(bloque.disponible, false);
    assert.equal(bloque.motivoNoDisponible, "sin_cupos");
    assert.equal((await reservar()).status, 409);
  });

  test("una reserva puede terminar a medianoche sin cruzar la jornada ni ignorar bloqueos", async () => {
    await prisma.disponibilidad.updateMany({
      where: { recursoId: espacioId },
      data: { minutosFin: 1440 },
    });
    const fin = iso(0, sumarDiasFecha(fecha, 1));
    const body = { espacioId, fechaHoraInicio: iso(23), fechaHoraFin: fin };
    assert.equal(
      (await request("POST", "/api/reservas", body, usuarioToken)).status,
      201,
    );
    const response = await request("POST", ruta(), {
      tipo: "FRANJA",
      fechaHoraInicio: iso(23),
      fechaHoraFin: fin,
      motivo: "Cierre",
    });
    assert.equal(response.status, 201);
    assert.equal(
      (await request("POST", "/api/reservas", body, usuarioToken)).status,
      409,
    );
  });

  test("las reservas anteriores no se modifican ni cancelan al crear o eliminar un bloqueo", async () => {
    const response = await reservar(10, 11, true);
    assert.equal(response.status, 201, await response.clone().text());
    const { data } = await response.json();
    const anterior = await prisma.reserva.findUnique({
      where: { id: data.id },
      include: { recursos: true },
    });
    const bloqueo = await bloquear();
    assert.equal((await reservar()).status, 409);
    assert.deepEqual(
      await prisma.reserva.findUnique({
        where: { id: data.id },
        include: { recursos: true },
      }),
      anterior,
    );
    await request("DELETE", `${ruta()}/${bloqueo.id}`);
    assert.deepEqual(
      await prisma.reserva.findUnique({
        where: { id: data.id },
        include: { recursos: true },
      }),
      anterior,
    );
  });

  test("un hold anterior no puede confirmarse durante el bloqueo y puede hacerlo al eliminarlo", async () => {
    const hold = (await (await reservar()).json()).data;
    const bloqueo = await bloquear();
    assert.equal(
      (
        await request(
          "POST",
          `/api/reservas/${hold.id}/confirmar`,
          undefined,
          usuarioToken,
        )
      ).status,
      409,
    );
    assert.ok(
      await prisma.reservaPendiente.findUnique({ where: { id: hold.id } }),
    );
    await request("DELETE", `${ruta()}/${bloqueo.id}`);
    assert.equal(
      (
        await request(
          "POST",
          `/api/reservas/${hold.id}/confirmar`,
          undefined,
          usuarioToken,
        )
      ).status,
      200,
    );
  });

  test("PostgreSQL rechaza intervalos inválidos aunque se intente omitir la API", async () => {
    await assert.rejects(
      prisma.bloqueo.create({
        data: {
          recursoId: espacioId,
          fechaHoraInicio: new Date(iso(12)),
          fechaHoraFin: new Date(iso(10)),
          motivo: "Inválido",
        },
      }),
    );
  });
});

// Mantiene un lock real para poner ambas solicitudes HTTP en cola y verificar
// los dos órdenes de ejecución. pg_stat_activity prueba que efectivamente esperan.
async function esperarLocks(cantidad: number) {
  const limite = Date.now() + 8000;
  while (Date.now() < limite) {
    const [{ total }] = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
      AND query LIKE '%FROM "Recurso"%' AND query LIKE '%FOR UPDATE%'
    `;
    if (Number(total) >= cantidad) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No se observaron ${cantidad} solicitudes esperando el lock`);
}

async function enOrden<T, U>(
  primero: () => Promise<T>,
  segundo: () => Promise<U>,
): Promise<[T, U]> {
  let peticionA!: Promise<T>;
  let peticionB!: Promise<U>;
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Recurso" WHERE id = ${espacioId} FOR UPDATE`;
      peticionA = primero();
      await esperarLocks(1);
      peticionB = segundo();
      await esperarLocks(2);
    },
    { timeout: 20000 },
  );
  return Promise.all([peticionA, peticionB]);
}

describe("concurrencia PostgreSQL", () => {
  test("bloqueo primero: una reserva concurrente no logra atravesarlo", async () => {
    const [bloqueo, reserva] = await enOrden(
      () => request("POST", ruta(), franja()),
      () => reservar(),
    );
    assert.equal(bloqueo.status, 201);
    assert.equal(reserva.status, 409);
  });

  test("reserva confirmada primero: un bloqueo concurrente preserva esa reserva", async () => {
    const [reserva, bloqueo] = await enOrden(
      () => reservar(10, 11, true),
      () => request("POST", ruta(), franja()),
    );
    assert.equal(reserva.status, 201);
    assert.equal(bloqueo.status, 201);
    const { data } = await reserva.json();
    assert.equal(
      (await prisma.reserva.findUniqueOrThrow({ where: { id: data.id } }))
        .fechaHoraCancelacion,
      null,
    );
  });

  test("bloqueo primero: una confirmación concurrente del hold se rechaza", async () => {
    const hold = (await (await reservar()).json()).data;
    const [bloqueo, confirmacion] = await enOrden(
      () => request("POST", ruta(), franja()),
      () =>
        request(
          "POST",
          `/api/reservas/${hold.id}/confirmar`,
          undefined,
          usuarioToken,
        ),
    );
    assert.equal(bloqueo.status, 201);
    assert.equal(confirmacion.status, 409);
  });

  test("confirmación primero: la reserva queda preservada ante un bloqueo concurrente", async () => {
    const hold = (await (await reservar()).json()).data;
    const [confirmacion, bloqueo] = await enOrden(
      () =>
        request(
          "POST",
          `/api/reservas/${hold.id}/confirmar`,
          undefined,
          usuarioToken,
        ),
      () => request("POST", ruta(), franja()),
    );
    assert.equal(confirmacion.status, 200);
    assert.equal(bloqueo.status, 201);
  });

  test("dos confirmaciones simultáneas no duplican la reserva", async () => {
    const hold = (await (await reservar()).json()).data;
    const confirmar = () =>
      request(
        "POST",
        `/api/reservas/${hold.id}/confirmar`,
        undefined,
        usuarioToken,
      );
    const respuestas = await enOrden(confirmar, confirmar);
    assert.deepEqual(respuestas.map((r) => r.status).sort(), [200, 404]);
    assert.equal(await prisma.reserva.count({ where: { usuarioId } }), 1);
  });
});
