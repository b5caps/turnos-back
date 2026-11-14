import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { bloquearRecursos } from "../lib/bloqueos.js";
import { bloquearReserva } from "../lib/reservas-lock.js";
import { reloj } from "../lib/reloj.js";
import { datosAsistencia } from "../lib/reservas-estado.js";
import type { TokenPayload } from "./auth.service.js";

export class AsistenciaNotFoundError extends Error {}
export class AsistenciaForbiddenError extends Error {}
export class AsistenciaConflictError extends Error {}

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function exigirAdmin(usuario: TokenPayload) {
  if (usuario.rol !== "ADMIN")
    throw new AsistenciaForbiddenError(
      "Se requieren permisos de administrador",
    );
}

async function exigirEspacio(tx: Prisma.TransactionClient, id: number) {
  if (
    !(await tx.recurso.findFirst({
      where: { id, sala: { isNot: null } },
      select: { id: true },
    }))
  ) {
    throw new AsistenciaNotFoundError("Espacio no encontrado");
  }
}

export async function emitirQrEspacio(id: number, usuario: TokenPayload) {
  exigirAdmin(usuario);
  const tokenQr = randomBytes(32).toString("base64url");
  const url = new URL(
    process.env.CHECK_IN_URL ?? "http://localhost:5000/asistencia",
  );
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("CHECK_IN_URL debe ser una URL HTTP(S)");
  // El fragmento evita enviar el token al servidor web al abrir el enlace.
  url.hash = new URLSearchParams({ tokenQr }).toString();
  const qrSvg = await QRCode.toString(url.toString(), {
    type: "svg",
    errorCorrectionLevel: "M",
  });
  const qr = await prisma.$transaction(async (tx) => {
    await bloquearRecursos(tx, [id]);
    await exigirEspacio(tx, id);
    await tx.qrEspacio.updateMany({
      where: { recursoId: id, fechaRevocacion: null },
      data: { fechaRevocacion: reloj.ahora() },
    });
    return tx.qrEspacio.create({
      data: { recursoId: id, tokenHash: hash(tokenQr) },
    });
  });
  return {
    id: qr.id,
    recursoId: qr.recursoId,
    fechaCreacion: qr.fechaCreacion.toISOString(),
    tokenQr,
    url: url.toString(),
    qrSvg,
  };
}

export async function revocarQrEspacio(id: number, usuario: TokenPayload) {
  exigirAdmin(usuario);
  await prisma.$transaction(async (tx) => {
    await bloquearRecursos(tx, [id]);
    await exigirEspacio(tx, id);
    const resultado = await tx.qrEspacio.updateMany({
      where: { recursoId: id, fechaRevocacion: null },
      data: { fechaRevocacion: reloj.ahora() },
    });
    if (!resultado.count)
      throw new AsistenciaNotFoundError("El espacio no tiene un QR vigente");
  });
}

export async function consultarReservasParaQr(
  tokenQr: string,
  usuario: TokenPayload,
) {
  const qr = await prisma.qrEspacio.findUnique({
    where: { tokenHash: hash(tokenQr) },
  });
  if (!qr || qr.fechaRevocacion)
    throw new AsistenciaNotFoundError("QR inválido o revocado");
  const ahora = reloj.ahora();
  const reservas = await prisma.reserva.findMany({
    where: {
      usuarioId: usuario.id,
      fechaHoraConfirmacion: { not: null },
      fechaHoraCancelacion: null,
      fechaHoraCheckOut: null,
      fechaHoraInicio: { lte: ahora },
      fechaHoraFin: { gt: ahora },
      OR: [
        { fechaLimiteCheckIn: { gt: ahora } },
        { fechaHoraCheckIn: { not: null } },
      ],
      recursos: { some: { recursoId: qr.recursoId } },
    },
    orderBy: [{ fechaHoraInicio: "asc" }, { id: "asc" }],
  });
  return { recursoId: qr.recursoId, reservas: reservas.map(datosAsistencia) };
}

export async function registrarCheckIn(
  id: number,
  usuario: TokenPayload,
  tokenQr?: string,
) {
  const manual = tokenQr === undefined;
  if (manual) exigirAdmin(usuario);
  return prisma.$transaction(async (tx) => {
    if (!(await bloquearReserva(tx, id)))
      throw new AsistenciaNotFoundError("Reserva no encontrada");
    const reserva = await tx.reserva.findUnique({
      where: { id },
      include: { recursos: true },
    });
    if (!reserva) throw new AsistenciaNotFoundError("Reserva no encontrada");
    if (!manual && reserva.usuarioId !== usuario.id)
      throw new AsistenciaForbiddenError(
        "Solo puedes registrar tu propia asistencia mediante QR",
      );
    if (!manual) {
      const qr = await tx.qrEspacio.findUnique({
        where: { tokenHash: hash(tokenQr!) },
      });
      if (!qr || qr.fechaRevocacion)
        throw new AsistenciaNotFoundError("QR inválido o revocado");
      if (!reserva.recursos.some((r) => r.recursoId === qr.recursoId))
        throw new AsistenciaConflictError(
          "El QR no corresponde al espacio de esta reserva",
        );
    }
    if (
      !reserva.fechaHoraConfirmacion ||
      reserva.fechaHoraCancelacion ||
      reserva.fechaHoraCheckOut
    ) {
      throw new AsistenciaConflictError(
        "La reserva no está confirmada o ya está cancelada, liberada o finalizada",
      );
    }
    // Reintentos no cambian ni la fecha ni la autoría de una asistencia existente.
    if (reserva.fechaHoraCheckIn) return datosAsistencia(reserva);
    const ahora = reloj.ahora();
    if (ahora < reserva.fechaHoraInicio)
      throw new AsistenciaConflictError("La reserva todavía no comenzó");
    if (ahora >= reserva.fechaLimiteCheckIn || ahora >= reserva.fechaHoraFin)
      throw new AsistenciaConflictError(
        "El plazo para registrar asistencia ha vencido",
      );
    return datosAsistencia(
      await tx.reserva.update({
        where: { id },
        data: {
          fechaHoraCheckIn: ahora,
          origenCheckIn: manual ? "ADMIN" : "QR",
          checkInRegistradoPorId: usuario.id,
        },
      }),
    );
  });
}
