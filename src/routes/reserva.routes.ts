import { Hono } from 'hono'
import { cancelarReserva, crearReserva, listarReservas, obtenerReserva, registrarCheckIn, registrarCheckOut } from '../controllers/reserva.controller.js'

export const reservaRoutes = new Hono()

reservaRoutes.get('/', listarReservas)
reservaRoutes.get('/:id', obtenerReserva)
reservaRoutes.post('/', crearReserva)
reservaRoutes.patch('/:id/cancelar', cancelarReserva)
reservaRoutes.patch('/:id/check-in', registrarCheckIn)
reservaRoutes.patch('/:id/check-out', registrarCheckOut)
