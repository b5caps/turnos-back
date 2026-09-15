import { Hono } from 'hono'
import { actualizarNotebook, crearNotebook, listarNotebooks, obtenerNotebook } from '../controllers/notebook.controller.js'

export const notebookRoutes = new Hono()

notebookRoutes.get('/', listarNotebooks)
notebookRoutes.get('/:id', obtenerNotebook)
notebookRoutes.post('/', crearNotebook)
notebookRoutes.patch('/:id', actualizarNotebook)
