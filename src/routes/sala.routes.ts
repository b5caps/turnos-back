import { Hono } from 'hono'
import { actualizarSala, crearSala, listarSalas, obtenerSala } from '../controllers/sala.controller.js'

export const salaRoutes = new Hono()

salaRoutes.get('/', listarSalas)
salaRoutes.get('/:id', obtenerSala)
salaRoutes.post('/', crearSala)
salaRoutes.patch('/:id', actualizarSala)
