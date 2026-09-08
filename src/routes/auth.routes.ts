import { Hono } from 'hono'
import { login, register } from '../controllers/auth.controller.js'

export const authRoutes = new Hono()

authRoutes.post('/register', register)
authRoutes.post('/login', login)
