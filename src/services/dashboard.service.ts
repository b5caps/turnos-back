import { PrismaClient } from "@prisma/client";
import type { DashboardQuery } from "../schemas/dashboard.schema.js";

const prisma = new PrismaClient();

export async function obtenerMetricasDashboard(query: DashboardQuery) {
  const ahora = new Date();

  // 1. Determinar fecha objetivo (YYYY-MM-DD)
  const fechaStr =
    query.fecha ||
    `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;

  const [año, mes, dia] = fechaStr.split("-").map(Number);
  const inicioDia = new Date(año, mes - 1, dia, 0, 0, 0, 0);
  const finDia = new Date(año, mes - 1, dia, 23, 59, 59, 999);
  const diaSemana = new Date(año, mes - 1, dia).getDay();

  // 2. Ejecutar consultas concurrentes para máxima eficiencia
  const [
    totalRecursos,
    totalSalas,
    totalNotebooks,
    disponibilidadesDia,
    reservasDelDiaDB,
    reservasEnCursoDB,
    cancelacionesRecientesDB,
  ] = await Promise.all([
    prisma.recurso.count(),
    prisma.recurso.count({ where: { sala: { isNot: null } } }),
    prisma.recurso.count({ where: { notebook: { isNot: null } } }),
    prisma.disponibilidad.findMany({ where: { diaSemana } }),
    prisma.reserva.findMany({
      where: {
        fechaHoraInicio: { lte: finDia },
        fechaHoraFin: { gte: inicioDia },
      },
      include: {
        recursos: true,
      },
    }),
    prisma.reservaRecurso.findMany({
      where: {
        reserva: {
          fechaHoraCancelacion: null,
          fechaHoraInicio: { lte: ahora },
          fechaHoraFin: { gt: ahora },
        },
      },
      include: {
        recurso: {
          include: { sala: true, notebook: true },
        },
      },
    }),
    prisma.reserva.findMany({
      where: {
        fechaHoraCancelacion: { not: null },
      },
      orderBy: {
        fechaHoraCancelacion: "desc",
      },
      take: query.limiteCancelaciones ?? 5,
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
          },
        },
        recursos: {
          include: {
            recurso: {
              select: {
                id: true,
                nombre: true,
              },
            },
          },
        },
      },
    }),
  ]);

  // 3. Contadores de reservas del día
  let totalReservas = reservasDelDiaDB.length;
  let canceladas = 0;
  let activas = 0;
  let enCurso = 0;
  let finalizadas = 0;
  let totalMilisegundosReservados = 0;

  for (const reserva of reservasDelDiaDB) {
    if (reserva.fechaHoraCancelacion !== null) {
      canceladas++;
    } else {
      activas++;
      if (reserva.fechaHoraFin <= ahora) {
        finalizadas++;
      } else if (
        reserva.fechaHoraInicio <= ahora &&
        reserva.fechaHoraFin > ahora
      ) {
        enCurso++;
      }

      // Cálculo de horas para la tasa de ocupación del día
      const rInicio = Math.max(
        reserva.fechaHoraInicio.getTime(),
        inicioDia.getTime(),
      );
      const rFin = Math.min(reserva.fechaHoraFin.getTime(), finDia.getTime());
      if (rFin > rInicio) {
        const cantidadRecursos = Math.max(1, reserva.recursos.length);
        totalMilisegundosReservados += (rFin - rInicio) * cantidadRecursos;
      }
    }
  }

  // 4. Ocupación en tiempo real (instantánea)
  const recursosOcupadosIds = new Set<number>();
  let salasOcupadasCount = 0;
  let notebooksOcupadasCount = 0;

  for (const rr of reservasEnCursoDB) {
    if (!recursosOcupadosIds.has(rr.recursoId)) {
      recursosOcupadosIds.add(rr.recursoId);
      if (rr.recurso.sala) salasOcupadasCount++;
      if (rr.recurso.notebook) notebooksOcupadasCount++;
    }
  }

  const recursosOcupados = recursosOcupadosIds.size;
  const recursosDisponibles = Math.max(0, totalRecursos - recursosOcupados);
  const porcentajeOcupacion =
    totalRecursos > 0
      ? Number(((recursosOcupados / totalRecursos) * 100).toFixed(1))
      : 0;

  const porcentajeSalas =
    totalSalas > 0
      ? Number(((salasOcupadasCount / totalSalas) * 100).toFixed(1))
      : 0;

  const porcentajeNotebooks =
    totalNotebooks > 0
      ? Number(((notebooksOcupadasCount / totalNotebooks) * 100).toFixed(1))
      : 0;

  // 5. Tasa de ocupación diaria acumulada
  let minutosApertura = 480; // 08:00 por defecto
  let minutosCierre = 1320; // 22:00 por defecto
  if (disponibilidadesDia.length > 0) {
    minutosApertura = Math.min(
      ...disponibilidadesDia.map((d) => d.minutosInicio),
    );
    minutosCierre = Math.max(...disponibilidadesDia.map((d) => d.minutosFin));
  }

  const duracionJornadaMs = Math.max(
    0,
    (minutosCierre - minutosApertura) * 60 * 1000,
  );
  const capacidadTotalDiaMs = totalRecursos * duracionJornadaMs;

  const tasaOcupacionDia =
    capacidadTotalDiaMs > 0
      ? Number(
          ((totalMilisegundosReservados / capacidadTotalDiaMs) * 100).toFixed(1),
        )
      : 0;

  // 6. Formateo de cancelaciones recientes
  const cancelacionesRecientes = cancelacionesRecientesDB.map((c) => ({
    id: c.id,
    usuario: c.usuario,
    recursos: c.recursos.map((r) => ({
      id: r.recurso.id,
      nombre: r.recurso.nombre,
    })),
    fechaHoraInicio: c.fechaHoraInicio.toISOString(),
    fechaHoraFin: c.fechaHoraFin.toISOString(),
    fechaHoraCancelacion: c.fechaHoraCancelacion!.toISOString(),
    motivoCancelacion: c.motivoCancelacion ?? null,
  }));

  return {
    fecha: fechaStr,
    reservasDelDia: {
      total: totalReservas,
      activas,
      enCurso,
      finalizadas,
      canceladas,
    },
    ocupacionActual: {
      totalRecursos,
      recursosOcupados,
      recursosDisponibles,
      porcentajeOcupacion,
      desglose: {
        salas: {
          total: totalSalas,
          ocupadas: salasOcupadasCount,
          porcentaje: porcentajeSalas,
        },
        notebooks: {
          total: totalNotebooks,
          ocupadas: notebooksOcupadasCount,
          porcentaje: porcentajeNotebooks,
        },
      },
    },
    tasaOcupacionDia,
    cancelacionesRecientes,
  };
}
