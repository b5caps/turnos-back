import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('Password123', 10)

  const usuario = await prisma.usuario.upsert({
    where: { email: 'mc@test.com' },
    update: {},
    create: {
      nombre: 'Mc',
      apellido: 'Test',
      email: 'mc@test.com',
      documento: '46577511',
      passwordHash,
      rol: 'UTN',
      legajo: '12345',
    },
  })

  const sala = await prisma.sala.upsert({
    where: { id: 1 },
    update: {},
    create: {
      nombre: 'Sala de Estudio 1',
      descripcion: 'Sala grupal con proyector',
      ubicacion: 'Planta baja',
      capacidad: 4,
    },
  })

  const notebook = await prisma.notebook.upsert({
    where: { codigo: 'NB-001' },
    update: {},
    create: { codigo: 'NB-001', marca: 'Lenovo', modelo: 'ThinkPad E14' },
  })

  await prisma.reserva.upsert({
    where: { id: 1 },
    update: {},
    create: {
      usuarioId: usuario.id,
      salaId: sala.id,
      notebookId: notebook.id,
      cantidadPersonas: 1,
      fechaHoraInicio: new Date('2026-09-15T14:00:00'),
      fechaHoraFin: new Date('2026-09-15T15:00:00'),
      fechaLimiteCheckIn: new Date('2026-09-15T14:15:00'),
    },
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
