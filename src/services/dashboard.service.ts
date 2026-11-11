import type { DashboardQuery } from "../schemas/dashboard.schema.js";
import { obtenerConfiguracion } from "./configuracion.service.js";
import { prisma } from "../lib/prisma.js";

function formatearFechaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function obtenerMetricasDashboard(query: DashboardQuery) {
  const ahora = new Date();
  const hoyStr = formatearFechaLocal(ahora);

  // 1. Determinar rango objetivo (desde/hasta o fecha única)
  const fechaInicioStr =
    query.desde ?? query.hasta ?? query.fecha ?? hoyStr;
  const fechaFinStr =
    query.hasta ?? query.desde ?? query.fecha ?? hoyStr;

  const [anioIni, mesIni, diaIni] = fechaInicioStr.split("-").map(Number);
  const [anioFin, mesFin, diaFin] = fechaFinStr.split("-").map(Number);

  const inicioPeriodo = new Date(anioIni, mesIni - 1, diaIni, 0, 0, 0, 0);
  const finPeriodo = new Date(anioFin, mesFin - 1, diaFin, 23, 59, 59, 999);

  const diasPeriodo = Math.max(
    1,
    Math.round(
      (new Date(anioFin, mesFin - 1, diaFin).getTime() -
        new Date(anioIni, mesIni - 1, diaIni).getTime()) /
        (24 * 60 * 60 * 1000),
    ) + 1,
  );

  // Instante de referencia para calcular ocupación instantánea:
  // si el período consultado incluye hoy, usa la hora actual; si no, mediodía del inicio del período.
  const incluyeHoy = hoyStr >= fechaInicioStr && hoyStr <= fechaFinStr;
  const referenciaOcupacion = incluyeHoy
    ? ahora
    : new Date(anioIni, mesIni - 1, diaIni, 12, 0, 0, 0);

  // 2. Ejecutar consultas concurrentes filtrando únicamente recursos activos
  const [
    config,
    totalRecursos,
    totalSalas,
    totalNotebooks,
    salasActivas,
    reservasDelPeriodoDB,
    reservasEnCursoDB,
    cancelacionesRecientesDB,
  ] = await Promise.all([
    obtenerConfiguracion(),
    prisma.recurso.count({ where: { activo: true } }),
    prisma.recurso.count({ where: { activo: true, sala: { isNot: null } } }),
    prisma.recurso.count({ where: { activo: true, notebook: { isNot: null } } }),
    prisma.recurso.findMany({
      where: { activo: true, sala: { isNot: null } },
      select: {
        id: true,
        nombre: true,
        capacidad: true,
        sala: { select: { ubicacion: true } },
      },
      orderBy: { nombre: "asc" },
    }),
    prisma.reserva.findMany({
      where: {
        fechaHoraInicio: { lte: finPeriodo },
        fechaHoraFin: { gte: inicioPeriodo },
      },
      include: {
        recursos: true,
      },
    }),
    prisma.reservaRecurso.findMany({
      where: {
        recurso: { activo: true },
        reserva: {
          fechaHoraCancelacion: null,
          fechaHoraCheckOut: null,
          fechaHoraInicio: { lte: referenciaOcupacion },
          fechaHoraFin: { gt: referenciaOcupacion },
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

  // 3. Contadores de reservas del período y acumulación por espacio
  const totalReservas = reservasDelPeriodoDB.length;
  let canceladas = 0;
  let activas = 0;
  let enCurso = 0;
  let finalizadas = 0;
  let totalMilisegundosReservados = 0;

  const statsPorEspacio = new Map<
    number,
    { cantidadReservas: number; msReservados: number }
  >();
  for (const sala of salasActivas) {
    statsPorEspacio.set(sala.id, { cantidadReservas: 0, msReservados: 0 });
  }

  for (const reserva of reservasDelPeriodoDB) {
    if (reserva.fechaHoraCancelacion !== null) {
      canceladas++;
    } else {
      activas++;
      if (reserva.fechaHoraFin <= ahora || reserva.fechaHoraCheckOut !== null) {
        finalizadas++;
      } else if (
        reserva.fechaHoraInicio <= ahora &&
        reserva.fechaHoraFin > ahora
      ) {
        enCurso++;
      }

      const finEfectivo = reserva.fechaHoraCheckOut ?? reserva.fechaHoraFin;
      const rInicio = Math.max(
        reserva.fechaHoraInicio.getTime(),
        inicioPeriodo.getTime(),
      );
      const rFin = Math.min(finEfectivo.getTime(), finPeriodo.getTime());
      if (rFin > rInicio) {
        const duracionMs = rFin - rInicio;
        const cantidadRecursos = Math.max(1, reserva.recursos.length);
        totalMilisegundosReservados += duracionMs * cantidadRecursos;

        for (const rr of reserva.recursos) {
          const entry = statsPorEspacio.get(rr.recursoId);
          if (entry) {
            entry.cantidadReservas += 1;
            entry.msReservados += duracionMs;
          }
        }
      }
    }
  }

  // 4. Ocupación en el instante de referencia
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

  // 5. Tasa de ocupación acumulada del período
  const duracionJornadaMs = Math.max(
    0,
    (config.minutosCierre - config.minutosApertura) * 60 * 1000,
  );
  const capacidadJornadaPeriodoMs = duracionJornadaMs * diasPeriodo;
  const capacidadTotalPeriodoMs = totalRecursos * capacidadJornadaPeriodoMs;

  const tasaOcupacionDia =
    capacidadTotalPeriodoMs > 0
      ? Number(
          (
            (totalMilisegundosReservados / capacidadTotalPeriodoMs) *
            100
          ).toFixed(1),
        )
      : 0;

  // 6. Estadísticas y ocupación por cada espacio activo
  const ocupacionPorEspacio = salasActivas.map((sala) => {
    const stat = statsPorEspacio.get(sala.id) ?? {
      cantidadReservas: 0,
      msReservados: 0,
    };
    const horasReservadas = Number((stat.msReservados / 3_600_000).toFixed(2));
    const pct =
      capacidadJornadaPeriodoMs > 0
        ? Number(
            ((stat.msReservados / capacidadJornadaPeriodoMs) * 100).toFixed(1),
          )
        : 0;

    return {
      id: sala.id,
      nombre: sala.nombre,
      ubicacion: sala.sala?.ubicacion ?? "",
      capacidad: sala.capacidad,
      cantidadReservas: stat.cantidadReservas,
      horasReservadas,
      porcentajeOcupacion: pct,
      ocupadoActualmente: recursosOcupadosIds.has(sala.id),
    };
  });

  // 7. Formateo de cancelaciones recientes
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
    fecha: fechaInicioStr,
    ...(fechaInicioStr !== fechaFinStr || query.desde || query.hasta
      ? { desde: fechaInicioStr, hasta: fechaFinStr }
      : {}),
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
    ocupacionPorEspacio,
    cancelacionesRecientes,
  };
}
