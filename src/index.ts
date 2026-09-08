import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { prisma } from './lib/prisma.js'
import { authRoutes } from './routes/auth.routes.js'

const app = new Hono()
const port = Number(process.env.PORT ?? 3000)

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.route('/auth', authRoutes)

const startServer = async () => {
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    throw new Error('Faltan DATABASE_URL o JWT_SECRET en el archivo .env')
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un numero entre 1 y 65535')
  }

  await prisma.$connect()
  console.log('Base de datos conectada correctamente')

  serve({
    fetch: app.fetch,
    port
  }, (info) => {
    console.log(`Servidor corriendo en http://localhost:${info.port}`)
  })
}

startServer().catch(async (error) => {
  console.error('No se pudo iniciar el servidor:', error)
  await prisma.$disconnect()
  process.exit(1)
})
