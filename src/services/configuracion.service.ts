import { prisma } from "../lib/prisma.js";
import type { ActualizarConfiguracionInput } from "../schemas/configuracion.schema.js";

const VALORES_POR_DEFECTO = {
  id: 1,
  minutosApertura: 480, // 08:00
  minutosCierre: 1320, // 22:00
  tiempoMaximoAntelacionDias: 30,
  duracionMinimaMinutos: 30,
  duracionMaximaMinutos: 240,
  minutosGraciaCheckIn: 15,
};

export class ConfiguracionBusinessError extends Error {}

export async function obtenerConfiguracion() {
  const config = await prisma.configuracion.upsert({
    where: { id: 1 },
    create: VALORES_POR_DEFECTO,
    update: {},
  });

  return {
    id: config.id,
    minutosApertura: config.minutosApertura,
    minutosCierre: config.minutosCierre,
    tiempoMaximoAntelacionDias: config.tiempoMaximoAntelacionDias,
    duracionMinimaMinutos: config.duracionMinimaMinutos,
    duracionMaximaMinutos: config.duracionMaximaMinutos,
    minutosGraciaCheckIn: config.minutosGraciaCheckIn,
    actualizadoEn: config.actualizadoEn.toISOString(),
  };
}

export async function actualizarConfiguracion(
  input: ActualizarConfiguracionInput,
) {
  const actual = await obtenerConfiguracion();

  const nuevaApertura = input.minutosApertura ?? actual.minutosApertura;
  const nuevoCierre = input.minutosCierre ?? actual.minutosCierre;

  if (nuevaApertura >= nuevoCierre) {
    throw new ConfiguracionBusinessError(
      "Los minutos de apertura deben ser menores a los de cierre",
    );
  }

  const nuevaMinima =
    input.duracionMinimaMinutos ?? actual.duracionMinimaMinutos;
  const nuevaMaxima =
    input.duracionMaximaMinutos ?? actual.duracionMaximaMinutos;

  if (nuevaMinima > nuevaMaxima) {
    throw new ConfiguracionBusinessError(
      "La duración mínima no puede superar la duración máxima",
    );
  }

  const dataUpdate = {
    ...(input.minutosGraciaCheckIn !== undefined && {
      minutosGraciaCheckIn: input.minutosGraciaCheckIn,
    }),
    ...(input.minutosApertura !== undefined && {
      minutosApertura: input.minutosApertura,
    }),
    ...(input.minutosCierre !== undefined && {
      minutosCierre: input.minutosCierre,
    }),
    ...(input.tiempoMaximoAntelacionDias !== undefined && {
      tiempoMaximoAntelacionDias: input.tiempoMaximoAntelacionDias,
    }),
    ...(input.duracionMinimaMinutos !== undefined && {
      duracionMinimaMinutos: input.duracionMinimaMinutos,
    }),
    ...(input.duracionMaximaMinutos !== undefined && {
      duracionMaximaMinutos: input.duracionMaximaMinutos,
    }),
  };

  const actualizado = await prisma.configuracion.upsert({
    where: { id: 1 },
    update: dataUpdate,
    create: {
      ...VALORES_POR_DEFECTO,
      ...dataUpdate,
    },
  });

  return {
    id: actualizado.id,
    minutosApertura: actualizado.minutosApertura,
    minutosCierre: actualizado.minutosCierre,
    tiempoMaximoAntelacionDias: actualizado.tiempoMaximoAntelacionDias,
    duracionMinimaMinutos: actualizado.duracionMinimaMinutos,
    duracionMaximaMinutos: actualizado.duracionMaximaMinutos,
    minutosGraciaCheckIn: actualizado.minutosGraciaCheckIn,
    actualizadoEn: actualizado.actualizadoEn.toISOString(),
  };
}
