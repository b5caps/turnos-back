import { Hono } from 'hono'
import { listarNotificaciones, marcarComoLeida } from '../controllers/notificacion.controller.js'

export const notificacionRoutes = new Hono()

notificacionRoutes.get('/', listarNotificaciones)
notificacionRoutes.patch('/:id/leida', marcarComoLeida)
