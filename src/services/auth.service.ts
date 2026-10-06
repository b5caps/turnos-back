import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import type { Usuario } from "@prisma/client";
import type { RegistroInput } from "../schemas/auth.schema.js";

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

function datosPublicos(usuario: Usuario) {
  return {
    id: usuario.id,
    rol: usuario.rol,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    email: usuario.email,
  };
}

function configuracionJwt() {
  const secreto = process.env.JWT_SECRET;
  if (!secreto) throw new Error("JWT_SECRET no está configurado");

  const expiresIn = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 86400);
  if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
    throw new Error(
      "JWT_EXPIRES_IN_SECONDS debe ser un número entero positivo",
    );
  }

  return { secreto, expiresIn };
}

function crearToken(usuario: Usuario, config = configuracionJwt()) {
  return {
    token: jwt.sign({ rol: usuario.rol }, config.secreto, {
      subject: String(usuario.id),
      expiresIn: config.expiresIn,
    }),
    expiresIn: config.expiresIn,
  };
}

export async function registrar(input: RegistroInput) {
  // Verificar la configuración antes de crear la cuenta, para no dejar registros sin respuesta utilizable.
  const jwtConfig = configuracionJwt();
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const usuario = await prisma.usuario.create({
    data: {
      tipoDocumento: input.tipoDocumento,
      documento: input.documento.trim(),
      nombre: input.nombre.trim(),
      apellido: input.apellido.trim(),
      email: input.email.trim().toLowerCase(),
      telefono: input.telefono.trim(),
      rol: input.rol,
      passwordHash,
      ...(input.rol === "UTN"
        ? {
            perfilUTN: {
              create: {
                legajo: input.legajo.trim(),
                docente: input.docente,
                carrera: input.carrera?.trim(),
                ultimaSincronizacion: new Date().toISOString(),
              },
            },
          }
        : {
            perfilExterno: {
              create: {
                localidad: input.localidad.trim(),
                provincia: input.provincia.trim(),
                organizacion: input.organizacion.trim(),
              },
            },
          }),
    },
  });

  return { usuario: datosPublicos(usuario), ...crearToken(usuario, jwtConfig) };
}

export async function iniciarSesion(email: string, password: string) {
  const usuario = await prisma.usuario.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (
    !usuario?.passwordHash ||
    !(await bcrypt.compare(password, usuario.passwordHash))
  ) {
    return null;
  }

  return { usuario: datosPublicos(usuario), ...crearToken(usuario) };
}
