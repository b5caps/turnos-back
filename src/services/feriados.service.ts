import { prisma } from "../lib/prisma.js";
import { fechaDelEstablecimiento } from "../lib/horarios.js";
import { reloj } from "../lib/reloj.js";
import type { ListarFeriadosQuery } from "../schemas/feriados.schema.js";

export async function listarFeriadosPorAnio(query: ListarFeriadosQuery) {
  const anioActual = Number(fechaDelEstablecimiento(reloj.ahora()).slice(0, 4));
  const anio = query.anio ?? anioActual;
  const prefijo = `${anio}-`;

  const feriados = await prisma.feriado.findMany({
    where: {
      fecha: { startsWith: prefijo },
    },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
  });

  return {
    anio,
    data: feriados.map((f) => ({
      id: f.id,
      fecha: f.fecha,
      nombre: f.nombre,
      creadoPorId: f.creadoPorId,
      fechaCreacion: f.fechaCreacion.toISOString(),
    })),
  };
}
