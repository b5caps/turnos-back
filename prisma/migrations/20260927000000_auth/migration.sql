-- Las cuentas UTN anteriores no tienen contraseña; permanecen sin acceso hasta asignarles una.
-- Alinear las columnas de recurso con el esquema actual antes de habilitar nuevos registros.
ALTER TABLE "Recurso" ADD COLUMN "descripcion" TEXT NOT NULL DEFAULT '';
UPDATE "Recurso" AS r
SET "descripcion" = s."descripcion"
FROM "Sala" AS s
WHERE s."recursoId" = r."id";
ALTER TABLE "Recurso" ALTER COLUMN "descripcion" DROP DEFAULT;
ALTER TABLE "Sala" DROP COLUMN "descripcion";

-- Sin integración con SysAcad todavía no hay fecha real de sincronización.
ALTER TABLE "PerfilUTN" ALTER COLUMN "ultimaSincronizacion" DROP NOT NULL;

ALTER TABLE "Usuario" ADD COLUMN "passwordHash" TEXT;

UPDATE "Usuario" AS u
SET "passwordHash" = p."passwordHash"
FROM "PerfilExterno" AS p
WHERE p."usuarioId" = u."id";

ALTER TABLE "PerfilExterno" DROP COLUMN "passwordHash";

CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");
CREATE UNIQUE INDEX "Usuario_tipoDocumento_documento_key" ON "Usuario"("tipoDocumento", "documento");
CREATE UNIQUE INDEX "PerfilUTN_legajo_key" ON "PerfilUTN"("legajo");
