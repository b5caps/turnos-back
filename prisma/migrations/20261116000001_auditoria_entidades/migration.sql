CREATE TYPE "TipoEntidadAuditoria" AS ENUM ('ESPACIO', 'CONFIGURACION');

CREATE TYPE "AccionEntidadAuditoria" AS ENUM (
  'CREACION',
  'ACTUALIZACION',
  'DESACTIVACION',
  'ELIMINACION'
);

CREATE TABLE "EntidadBitacora" (
  "id" SERIAL NOT NULL,
  "entidadTipo" "TipoEntidadAuditoria" NOT NULL,
  "entidadId" INTEGER NOT NULL,
  "accion" "AccionEntidadAuditoria" NOT NULL,
  "actorId" INTEGER,
  "actorRol" "Rol" NOT NULL,
  "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detalle" TEXT,
  CONSTRAINT "EntidadBitacora_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EntidadBitacora_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "Usuario"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "EntidadBitacora_entidadTipo_entidadId_fechaHora_id_idx"
ON "EntidadBitacora"("entidadTipo", "entidadId", "fechaHora", "id");
