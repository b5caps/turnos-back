import { Hono } from 'hono'
import { actualizarUsuario, crearUsuario, iniciarSesion, listarUsuarios, obtenerUsuario } from '../controllers/usuario.controller.js'

export const usuarioRoutes = new Hono()

usuarioRoutes.get('/', listarUsuarios)
usuarioRoutes.get('/:id', obtenerUsuario)
usuarioRoutes.post('/', crearUsuario)
usuarioRoutes.post('/login', iniciarSesion)
usuarioRoutes.patch('/:id', actualizarUsuario)
