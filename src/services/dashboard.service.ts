import { PrismaClient } from "@prisma/client";
import type {
  DashboardQuery,
  DashboardResponse,
} from "../schemas/dashboard.schema.js";

const prisma = new PrismaClient();

export async function obtenerMetricasDashboard(
  query: DashboardQuery,
): Promise<DashboardResponse["data"]> {
  const ahora = new Date();
  const seleccion =
    query.periodo === "diario"
      ? {
          periodo: query.periodo,
          fecha:
            query.fecha ??
            `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`,
        }
      : query;
  const [año, mes, dia] =
    seleccion.periodo === "diario"
      ? seleccion.fecha.split("-").map(Number)
      : [
          seleccion.anio,
          seleccion.periodo === "mensual" ? seleccion.mes : 1,
          1,
        ];

  // Límites locales del servidor: inicio inclusivo y fin exclusivo.
  // setFullYear también respeta los años entre 0000 y 0099.
  const inicioPeriodo = new Date(0);
  inicioPeriodo.setFullYear(año, mes - 1, dia);
  inicioPeriodo.setHours(0, 0, 0, 0);
  if (query.periodo === "mensual") inicioPeriodo.setDate(1);
  if (query.periodo === "anual") inicioPeriodo.setMonth(0, 1);

  const finPeriodo = new Date(inicioPeriodo);
  if (query.periodo === "anual") {
    finPeriodo.setFullYear(finPeriodo.getFullYear() + 1);
  } else if (query.periodo === "mensual") {
    finPeriodo.setMonth(finPeriodo.getMonth() + 1);
  } else {
    finPeriodo.setDate(finPeriodo.getDate() + 1);
  }

  const [
    reservasPeriodo,
    totalSalas,
    totalNotebooks,
    salasOcupadas,
    notebooksOcupadas,
  ] = await Promise.all([
    prisma.reserva.findMany({
      where: {
        fechaHoraInicio: { gte: inicioPeriodo, lt: finPeriodo },
      },
      select: {
        fechaHoraInicio: true,
        fechaHoraFin: true,
        fechaHoraCancelacion: true,
      },
    }),
    prisma.recurso.count({ where: { sala: { isNot: null } } }),
    prisma.recurso.count({ where: { notebook: { isNot: null } } }),
    // Contar recursos, no reservas: varias reservas de una sala cuentan una vez.
    prisma.recurso.count({
      where: {
        sala: { isNot: null },
        reservas: {
          some: {
            reserva: {
              fechaHoraCancelacion: null,
              fechaHoraInicio: { lte: ahora },
              fechaHoraFin: { gt: ahora },
            },
          },
        },
      },
    }),
    prisma.recurso.count({
      where: {
        notebook: { isNot: null },
        reservas: {
          some: {
            reserva: {
              fechaHoraCancelacion: null,
              fechaHoraInicio: { lte: ahora },
              fechaHoraFin: { gt: ahora },
            },
          },
        },
      },
    }),
  ]);

  const reservas = {
    total: reservasPeriodo.length,
    pendientes: 0,
    enCurso: 0,
    finalizadas: 0,
    canceladas: 0,
  };

  for (const reserva of reservasPeriodo) {
    if (reserva.fechaHoraCancelacion !== null) {
      reservas.canceladas++;
    } else if (reserva.fechaHoraFin <= ahora) {
      reservas.finalizadas++;
    } else if (reserva.fechaHoraInicio <= ahora) {
      reservas.enCurso++;
    } else {
      reservas.pendientes++;
    }
  }

  const porcentaje = (ocupadas: number, total: number) =>
    total > 0 ? Number(((ocupadas / total) * 100).toFixed(1)) : 0;

  return {
    ...seleccion,
    reservas,
    ocupacionActual: {
      salas: {
        total: totalSalas,
        ocupadas: salasOcupadas,
        porcentaje: porcentaje(salasOcupadas, totalSalas),
      },
      notebooks: {
        total: totalNotebooks,
        ocupadas: notebooksOcupadas,
        porcentaje: porcentaje(notebooksOcupadas, totalNotebooks),
      },
    },
  };
}
