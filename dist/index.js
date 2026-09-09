import { serve } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import recursosRoutes from './routes/recursos.routes.js';
import reservasRoutes from './routes/reservas.routes.js';
const app = new OpenAPIHono();
app.get('/', (c) => {
    return c.text('Hello Hono!');
});
app.route('/api/recursos', recursosRoutes);
app.route('/api/reservas', reservasRoutes);
app.doc('/doc', {
    openapi: '3.0.0',
    info: { version: '1.0.0', title: 'GREB/SIREB API' },
});
app.get('/docs', swaggerUI({ url: '/doc' }));
serve({
    fetch: app.fetch,
    port: 3000,
}, (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
    console.log(`Docs disponibles en http://localhost:${info.port}/docs`);
});
