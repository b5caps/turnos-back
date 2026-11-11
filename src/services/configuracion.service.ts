import type { ActualizarConfiguracionInput } from "../schemas/configuracion.schema.js";
import type { TokenPayload } from "./auth.service.js";
import {
  obtenerHistorialEntidad,
  registrarCambioEntidad,
  type CambioEntidad,
} from "./auditoria.service.js";
import { prisma } from "../lib/prisma.js";

const VALORES_POR_DEFECTO = {
  id: 1,
  minutosApertura: 480, // 08:00
  minutosCierre: 1320, // 22:00
  tiempoMaximoAntelacionDias: 30,
  duracionMinimaMinutos: 30,
  duracionMaximaMinutos: 240,
};

const TTL_CACHE_MS = 30_000;
let configCache: {
  data: {
    id: number;
    minutosApertura: number;
    minutosCierre: number;
    tiempoMaximoAntelacionDias: number;
    duracionMinimaMinutos: number;
    duracionMaximaMinutos: number;
    actualizadoEn: string;
  };
  expiresAt: number;
} | null = null;

export function invalidarCacheConfiguracion() {
  configCache = null;
}

export class ConfiguracionBusinessError extends Error {}

async function leerConfiguracionBase() {
  const ahora = Date.now();
  if (configCache && ahora < configCache.expiresAt) {
    return configCache.data;
  }

  let config = await prisma.configuracion.findUnique({
    where: { id: 1 },
  });

  if (!config) {
    try {
      config = await prisma.configuracion.create({
        data: VALORES_POR_DEFECTO,
      });
    } catch {
      config = {
        ...VALORES_POR_DEFECTO,
        actualizadoEn: new Date(),
      };
    }
  }

  const data = {
    id: config.id,
    minutosApertura: config.minutosApertura,
    minutosCierre: config.minutosCierre,
    tiempoMaximoAntelacionDias: config.tiempoMaximoAntelacionDias,
    duracionMinimaMinutos: config.duracionMinimaMinutos,
    duracionMaximaMinutos: config.duracionMaximaMinutos,
    actualizadoEn: config.actualizadoEn.toISOString(),
  };

  configCache = { data, expiresAt: ahora + TTL_CACHE_MS };
  return data;
}

export async function obtenerConfiguracion(incluirHistorial = false) {
  const base = await leerConfiguracionBase();
  if (!incluirHistorial) {
    return base;
  }

  const historialCambios: CambioEntidad[] = await obtenerHistorialEntidad(
    "CONFIGURACION",
    1,
  );
  const ultimo =
    historialCambios.length > 0
      ? historialCambios[historialCambios.length - 1]
      : null;

  return {
    ...base,
    actualizadoPorId: ultimo?.actorId ?? null,
    historialCambios,
  };
}

export async function actualizarConfiguracion(
  input: ActualizarConfiguracionInput,
  usuarioAuth?: TokenPayload,
) {
  invalidarCacheConfiguracion();
  const actual = await leerConfiguracionBase();

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

  const actualizado = await prisma.$transaction(async (tx) => {
    const cfg = await tx.configuracion.upsert({
      where: { id: 1 },
      update: dataUpdate,
      create: {
        ...VALORES_POR_DEFECTO,
        ...dataUpdate,
      },
    });

    // Propagar cambios en horario global de apertura/cierre hacia las disponibilidades
    if (
      input.minutosApertura !== undefined &&
      input.minutosApertura !== actual.minutosApertura
    ) {
      await tx.disponibilidad.updateMany({
        where: { minutosInicio: actual.minutosApertura },
        data: { minutosInicio: nuevaApertura },
      });
      await tx.disponibilidad.updateMany({
        where: { minutosInicio: { lt: nuevaApertura } },
        data: { minutosInicio: nuevaApertura },
      });
    }

    if (
      input.minutosCierre !== undefined &&
      input.minutosCierre !== actual.minutosCierre
    ) {
      await tx.disponibilidad.updateMany({
        where: { minutosFin: actual.minutosCierre },
        data: { minutosFin: nuevoCierre },
      });
      await tx.disponibilidad.updateMany({
        where: { minutosFin: { gt: nuevoCierre } },
        data: { minutosFin: nuevoCierre },
      });
    }

    return cfg;
  });

  const data = {
    id: actualizado.id,
    minutosApertura: actualizado.minutosApertura,
    minutosCierre: actualizado.minutosCierre,
    tiempoMaximoAntelacionDias: actualizado.tiempoMaximoAntelacionDias,
    duracionMinimaMinutos: actualizado.duracionMinimaMinutos,
    duracionMaximaMinutos: actualizado.duracionMaximaMinutos,
    actualizadoEn: actualizado.actualizadoEn.toISOString(),
  };

  configCache = { data, expiresAt: Date.now() + TTL_CACHE_MS };

  if (usuarioAuth) {
    await registrarCambioEntidad({
      entidadTipo: "CONFIGURACION",
      entidadId: 1,
      accion: "ACTUALIZACION",
      actorId: usuarioAuth.id,
      actorRol: usuarioAuth.rol,
      detalle: `Horario ${nuevaApertura}-${nuevoCierre}, antelación ${actualizado.tiempoMaximoAntelacionDias}d, duración ${actualizado.duracionMinimaMinutos}-${actualizado.duracionMaximaMinutos}m`,
    });
  }

  const historialCambios = await obtenerHistorialEntidad("CONFIGURACION", 1);
  const ultimo =
    historialCambios.length > 0
      ? historialCambios[historialCambios.length - 1]
      : null;

  return {
    ...data,
    actualizadoPorId: ultimo?.actorId ?? usuarioAuth?.id ?? null,
    historialCambios,
  };
}
