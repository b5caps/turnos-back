import assert from "node:assert/strict";
import { mock, test } from "node:test";

const ahora = new Date(2026, 9, 20, 12);
mock.timers.enable({ apis: ["Date"], now: ahora });

let reservas = [];
let recursos = [];
let rangoConsultado;

mock.module("@prisma/client", {
  namedExports: {
    PrismaClient: class {
      reserva = {
        findMany: async ({ where }) => {
          rangoConsultado = where.fechaHoraInicio;
          return reservas.filter(
            (r) =>
              r.fechaHoraInicio >= rangoConsultado.gte &&
              r.fechaHoraInicio < rangoConsultado.lt,
          );
        },
      };
      recurso = {
        count: async ({ where }) =>
          recursos.filter((r) => {
            const tipo = where.sala ? "sala" : "notebook";
            if (r.tipo !== tipo) return false;
            const filtro = where.reservas?.some.reserva;
            return (
              !filtro ||
              r.reservas.some(
                (reserva) =>
                  reserva.fechaHoraCancelacion === null &&
                  reserva.fechaHoraInicio <= filtro.fechaHoraInicio.lte &&
                  reserva.fechaHoraFin > filtro.fechaHoraFin.gt,
              )
            );
          }).length,
      };
    },
  },
});

const { obtenerMetricasDashboard } =
  await import("../src/services/dashboard.service.ts");
const { dashboardQuerySchema, dashboardResponseSchema } =
  await import("../src/schemas/dashboard.schema.ts");

function reserva(inicio, fin, cancelacion = null) {
  return {
    fechaHoraInicio: inicio,
    fechaHoraFin: fin,
    fechaHoraCancelacion: cancelacion,
  };
}

test("valida fechas reales y períodos; por defecto consulta el día actual", async () => {
  assert.equal(dashboardQuerySchema.parse({}).periodo, "diario");
  for (const fecha of ["2026-02-29", "2026-13-01", "20-10-2026"]) {
    assert.equal(
      dashboardQuerySchema.safeParse({ periodo: "diario", fecha }).success,
      false,
    );
  }
  assert.equal(
    dashboardQuerySchema.safeParse({ periodo: "semanal" }).success,
    false,
  );
  assert.equal(
    dashboardQuerySchema.safeParse({ periodo: "diario", fecha: "2024-02-29" })
      .success,
    true,
  );
  reservas = [];
  recursos = [];
  const data = await obtenerMetricasDashboard(dashboardQuerySchema.parse({}));
  assert.equal(data.fecha, "2026-10-20");
  assert.equal(data.periodo, "diario");
  assert.deepEqual(data.ocupacionActual, {
    salas: { total: 0, ocupadas: 0, porcentaje: 0 },
    notebooks: { total: 0, ocupadas: 0, porcentaje: 0 },
  });
});

test("clasifica estados excluyentes e incluye sólo inicios dentro del período", async () => {
  reservas = [
    reserva(new Date(2026, 9, 20, 14), new Date(2026, 9, 20, 15)),
    reserva(ahora, new Date(2026, 9, 20, 13)),
    reserva(new Date(2026, 9, 20, 11), ahora),
    reserva(new Date(2026, 9, 20, 14), new Date(2026, 9, 20, 15), ahora),
    reserva(new Date(2026, 9, 20), new Date(2026, 9, 20, 1)),
    reserva(new Date(2026, 9, 19, 23), new Date(2026, 9, 20, 1)),
    reserva(new Date(2026, 9, 21), new Date(2026, 9, 21, 1)),
  ];
  const data = await obtenerMetricasDashboard(
    dashboardQuerySchema.parse({ periodo: "diario", fecha: "2026-10-20" }),
  );
  assert.deepEqual(data.reservas, {
    total: 5,
    pendientes: 1,
    enCurso: 1,
    finalizadas: 2,
    canceladas: 1,
  });
  assert.deepEqual(rangoConsultado, {
    gte: new Date(2026, 9, 20),
    lt: new Date(2026, 9, 21),
  });
  assert.equal(dashboardResponseSchema.safeParse({ data }).success, true);
  assert.deepEqual(Object.keys(data).sort(), [
    "fecha",
    "ocupacionActual",
    "periodo",
    "reservas",
  ]);
});

test("calcula los límites mensuales y anuales, incluido febrero bisiesto", async () => {
  for (const [query, inicio, fin] of [
    [
      { periodo: "mensual", anio: "2024", mes: "2" },
      new Date(2024, 1, 1),
      new Date(2024, 2, 1),
    ],
    [
      { periodo: "mensual", anio: "2026", mes: "12" },
      new Date(2026, 11, 1),
      new Date(2027, 0, 1),
    ],
    [
      { periodo: "anual", anio: "2026" },
      new Date(2026, 0, 1),
      new Date(2027, 0, 1),
    ],
  ]) {
    reservas = [
      reserva(new Date(inicio.getTime() - 1), inicio),
      reserva(inicio, new Date(inicio.getTime() + 3600000)),
      reserva(new Date(fin.getTime() - 1), fin),
      reserva(fin, new Date(fin.getTime() + 3600000)),
    ];
    const data = await obtenerMetricasDashboard(
      dashboardQuerySchema.parse(query),
    );
    assert.deepEqual(rangoConsultado, { gte: inicio, lt: fin });
    assert.equal(data.reservas.total, 2);
    assert.equal(data.anio, Number(query.anio));
    assert.equal(data.mes, query.mes ? Number(query.mes) : undefined);
    assert.equal("fecha" in data, false);
    assert.equal(dashboardResponseSchema.safeParse({ data }).success, true);
  }
});

test("ocupación actual separada, sin duplicados ni reservas canceladas o finalizadas", async () => {
  const enCurso = reserva(new Date(2026, 9, 20, 11), new Date(2026, 9, 20, 13));
  recursos = [
    { tipo: "sala", reservas: [enCurso, enCurso] },
    { tipo: "sala", reservas: [{ ...enCurso, fechaHoraCancelacion: ahora }] },
    { tipo: "sala", reservas: [] },
    { tipo: "notebook", reservas: [enCurso] },
    { tipo: "notebook", reservas: [reserva(new Date(2026, 9, 20, 11), ahora)] },
  ];
  const consultar = (anio) =>
    obtenerMetricasDashboard(
      dashboardQuerySchema.parse({ periodo: "anual", anio }),
    );
  const actual = await consultar(2026);
  const historico = await consultar(2024);
  assert.deepEqual(actual.ocupacionActual, {
    salas: { total: 3, ocupadas: 1, porcentaje: 33.3 },
    notebooks: { total: 2, ocupadas: 1, porcentaje: 50 },
  });
  assert.deepEqual(historico.ocupacionActual, actual.ocupacionActual);
});

test("la ruta permite ADMIN y rechaza usuarios comunes y solicitudes sin token", async () => {
  process.env.JWT_SECRET = "dashboard-test-secret";
  const { default: jwt } = await import("jsonwebtoken");
  const { default: dashboard } =
    await import("../src/routes/dashboard.routes.ts");
  const consultar = async (rol, query = "periodo=mensual&anio=2026&mes=10") => {
    const headers = rol
      ? {
          Authorization: `Bearer ${jwt.sign({ rol }, process.env.JWT_SECRET, {
            subject: "1",
            expiresIn: 3600,
          })}`,
        }
      : {};
    return dashboard.request(`http://localhost/?${query}`, { headers });
  };
  assert.equal((await consultar()).status, 401);
  assert.equal((await consultar("UTN")).status, 403);
  assert.equal((await consultar("EXTERNO")).status, 403);
  const response = await consultar("ADMIN");
  assert.equal(response.status, 200);
  assert.equal(
    dashboardResponseSchema.safeParse(await response.json()).success,
    true,
  );
  for (const query of [
    "",
    "periodo=diario&fecha=2026-10-20",
    "periodo=anual&anio=2026",
  ]) {
    const valida = await consultar("ADMIN", query);
    assert.equal(valida.status, 200, query);
    assert.equal(
      dashboardResponseSchema.safeParse(await valida.json()).success,
      true,
    );
  }
  for (const query of [
    "periodo=diario",
    "fecha=2026-10-20",
    "periodo=mensual&anio=2026",
    "periodo=mensual&mes=10",
    "periodo=mensual&anio=2026&mes=13",
    "periodo=anual&anio=2026&mes=10",
    "periodo=anual&anio=2026&fecha=2026-10-20",
    "periodo=diario&fecha=2026-10-20&anio=2026",
    "periodo=mensual&fecha=2026-10-20",
    "periodo=anual&anio=0",
    "periodo=anual&anio=10000",
    "periodo=anual&anio=abc",
    "periodo=anual&anio=2026&limiteCancelaciones=5",
  ]) {
    const invalida = await consultar("ADMIN", query);
    assert.equal(invalida.status, 400, query);
    assert.equal(typeof (await invalida.json()).message, "string");
  }
});

test("Swagger documenta los parámetros explícitos y las respuestas por período", async () => {
  const { default: dashboard } =
    await import("../src/routes/dashboard.routes.ts");
  const doc = dashboard.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Dashboard", version: "1.0.0" },
  });
  assert.deepEqual(doc.paths["/"].get.parameters.map((p) => p.name).sort(), [
    "anio",
    "fecha",
    "mes",
    "periodo",
  ]);
});
