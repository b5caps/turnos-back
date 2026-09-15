import 'dotenv/config'
import { serve } from '@hono/node-server'
import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import { prisma } from './lib/prisma.js'
import { notebookRoutes } from './routes/notebook.routes.js'
import { notificacionRoutes } from './routes/notificacion.routes.js'
import { reservaRoutes } from './routes/reserva.routes.js'
import { salaRoutes } from './routes/sala.routes.js'
import { usuarioRoutes } from './routes/usuario.routes.js'

const app = new OpenAPIHono()
const port = Number(process.env.PORT ?? 3000)

app.get('/', (c) => c.text('Hello Hono!'))
app.route('/api/usuarios', usuarioRoutes)
app.route('/api/salas', salaRoutes)
app.route('/api/notebooks', notebookRoutes)
app.route('/api/reservas', reservaRoutes)
app.route('/api/notificaciones', notificacionRoutes)

app.doc('/doc', {
  openapi: '3.0.0',
  info: { version: '1.0.0', title: 'GREB/SIREB API' },
})

app.get('/docs', swaggerUI({ url: '/doc' }))

async function startServer() {
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    throw new Error('Faltan DATABASE_URL o JWT_SECRET en el archivo .env')
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un numero entre 1 y 65535')
  }

  await prisma.$connect()
  console.log('Base de datos conectada correctamente')

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Servidor corriendo en http://localhost:${info.port}`)
    console.log(`Documentacion disponible en http://localhost:${info.port}/docs`)
  })
}

startServer().catch(async (error) => {
  console.error('No se pudo iniciar el servidor:', error)
  await prisma.$disconnect()
  process.exit(1)
})
