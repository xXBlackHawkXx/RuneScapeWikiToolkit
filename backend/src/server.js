import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { parseAllowedOrigins } from './config/cors.js';
import { registerMediaWikiRoutes } from './routes/mediawiki.js';
import { registerFetchPageRoutes } from './routes/fetch-page.js';

const app = Fastify({
  logger: true,
  bodyLimit: 1024 * 1024 * 1024,
});

const allowedOrigins = parseAllowedOrigins();

await app.register(cookie);
await app.register(cors, {
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
  },
});

app.get('/health', async () => ({ ok: true }));

registerMediaWikiRoutes(app);
registerFetchPageRoutes(app);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info(`API server listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
