// prisma/seed.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const usuario = await prisma.usuario.create({
    data: {
      tipoDocumento: 'DNI',
      documento: '46577511',
      nombre: 'Mc',
      apellido: 'Test',
      email: 'mc@test.com',
      telefono: '3564000000',
      rol: 'UTN',
    },
  })

  const salaRecurso = await prisma.recurso.create({
    data: {
      nombre: 'Sala de Estudio 1',
      capacidad: 4,
      descripcion: 'Sala grupal con proyector',
      sala: { create: { ubicacion: 'Planta baja' } },
      disponibilidades: {
        create: [{ diaSemana: 6, minutosInicio: 480, minutosFin: 1320 }], // sábado 08:00-22:00
      },
    },
  })

  const notebookRecurso = await prisma.recurso.create({
    data: {
      nombre: 'Notebook 01',
      capacidad: 1,
      notebook: { create: { numeroSerie: 'NB-001', marca: 'Lenovo', modelo: 'ThinkPad E14' } },
      disponibilidades: {
        create: [{ diaSemana: 6, minutosInicio: 480, minutosFin: 1320 }],
      },
    },
  })

  const reserva = await prisma.reserva.create({
    data: {
      usuarioId: usuario.id,
      fechaHoraInicio: new Date('2026-09-05T14:00:00'),
      fechaHoraFin: new Date('2026-09-05T15:00:00'),
      fechaLimiteCheckIn: new Date('2026-09-05T14:15:00'),
    },
  })

  await prisma.reservaRecurso.create({
    data: { reservaId: reserva.id, recursoId: salaRecurso.id },
  })

  console.log('Seed cargado ✅')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())