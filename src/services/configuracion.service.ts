import { PrismaClient } from "@prisma/client";
import type { ActualizarConfiguracionInput } from "../schemas/configuracion.schema.js";

const prisma = new PrismaClient();

const VALORES_POR_DEFECTO = {
  id: 1,
  minutosApertura: 480, // 08:00
  minutosCierre: 1320, // 22:00
  tiempoMaximoAntelacionDias: 30,
  duracionMinimaMinutos: 30,
  duracionMaximaMinutos: 240,
};

export class ConfiguracionBusinessError extends Error {}

export async function obtenerConfiguracion() {
  const model = (prisma as unknown as Record<string, any>).configuracion;

  let config = model
    ? await model.findUnique({
        where: { id: 1 },
      })
    : null;

  if (!config && model) {
    try {
      config = await model.create({
        data: VALORES_POR_DEFECTO,
      });
    } catch {
      config = {
        ...VALORES_POR_DEFECTO,
        actualizadoEn: new Date(),
      };
    }
  } else if (!config) {
    config = {
      ...VALORES_POR_DEFECTO,
      actualizadoEn: new Date(),
    };
  }

  return {
    id: config.id,
    minutosApertura: config.minutosApertura,
    minutosCierre: config.minutosCierre,
    tiempoMaximoAntelacionDias: config.tiempoMaximoAntelacionDias,
    duracionMinimaMinutos: config.duracionMinimaMinutos,
    duracionMaximaMinutos: config.duracionMaximaMinutos,
    actualizadoEn: config.actualizadoEn
      ? config.actualizadoEn.toISOString()
      : new Date().toISOString(),
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

  const model = (prisma as unknown as Record<string, any>).configuracion;

  const actualizado = model
    ? await model.upsert({
        where: { id: 1 },
        update: {
          ...input,
        },
        create: {
          ...VALORES_POR_DEFECTO,
          ...input,
        },
      })
    : {
        ...VALORES_POR_DEFECTO,
        ...input,
        actualizadoEn: new Date(),
      };

  return {
    id: actualizado.id,
    minutosApertura: actualizado.minutosApertura,
    minutosCierre: actualizado.minutosCierre,
    tiempoMaximoAntelacionDias: actualizado.tiempoMaximoAntelacionDias,
    duracionMinimaMinutos: actualizado.duracionMinimaMinutos,
    duracionMaximaMinutos: actualizado.duracionMaximaMinutos,
    actualizadoEn: actualizado.actualizadoEn.toISOString(),
  };
}
