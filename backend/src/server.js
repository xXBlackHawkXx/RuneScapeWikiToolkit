import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';

const SESSION_COOKIE_NAME = 'mw_proxy_sid';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const app = Fastify({
  logger: true,
});

const sessions = new Map();

function parseAllowedOrigins() {
  const configured = [process.env.CORS_ORIGINS, process.env.FRONTEND_ORIGIN]
    .filter(Boolean)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];

  return new Set([...defaults, ...configured]);
}

function parseCookieHeader(header = '') {
  const entries = header.split(';').map((part) => part.trim()).filter(Boolean);
  const cookies = new Map();
  for (const entry of entries) {
    const index = entry.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const name = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    cookies.set(name, value);
  }
  return cookies;
}

function mergeSetCookies(existingHeader, setCookies) {
  const cookies = parseCookieHeader(existingHeader);

  for (const rawCookie of setCookies) {
    if (!rawCookie) {
      continue;
    }

    const [pair, ...attributes] = rawCookie.split(';').map((part) => part.trim());
    const index = pair.indexOf('=');
    if (index <= 0) {
      continue;
    }

    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();

    const shouldExpire = attributes.some((attribute) => {
      const [key, attributeValue = ''] = attribute.split('=');
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === 'max-age') {
        return Number(attributeValue) <= 0;
      }
      if (normalizedKey === 'expires') {
        const expiresAt = Date.parse(attributeValue);
        return Number.isFinite(expiresAt) && expiresAt <= Date.now();
      }
      return false;
    });

    if (shouldExpire) {
      cookies.delete(name);
    } else {
      cookies.set(name, value);
    }
  }

  return Array.from(cookies.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

function getOrCreateSession(request, reply) {
  const now = Date.now();
  let sid = request.cookies?.[SESSION_COOKIE_NAME];

  if (!sid || !sessions.has(sid)) {
    sid = randomUUID();
    sessions.set(sid, {
      cookies: '',
      touchedAt: now,
    });
  }

  const session = sessions.get(sid);
  session.touchedAt = now;

  const cookieSameSite = process.env.SESSION_COOKIE_SAMESITE;
  const isSecureCookie =
    process.env.SESSION_COOKIE_SECURE === 'true' || cookieSameSite === 'none';

  reply.setCookie(SESSION_COOKIE_NAME, sid, {
    path: '/',
    httpOnly: true,
    sameSite: cookieSameSite ?? (isSecureCookie ? 'none' : 'lax'),
    secure: isSecureCookie,
    maxAge: SESSION_TTL_MS / 1000,
  });

  return session;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [sid, session] of sessions.entries()) {
    if (now - session.touchedAt > SESSION_TTL_MS) {
      sessions.delete(sid);
    }
  }
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const setCookie = headers.get('set-cookie');
  return setCookie ? [setCookie] : [];
}

function addParams(searchParams, params) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    searchParams.set(key, String(value));
  }
}

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

app.route({
  method: ['GET', 'POST'],
  url: '/api/mediawiki',
  handler: async (request, reply) => {
    cleanupSessions();

    const payload = request.method === 'GET' ? request.query : request.body;
    const body = payload && typeof payload === 'object' ? payload : {};

    const { apiUrl, ...params } = body;

    if (!apiUrl || typeof apiUrl !== 'string') {
      reply.code(400);
      return { error: 'apiUrl is required and must be a string.' };
    }

    let target;
    try {
      target = new URL(apiUrl);
    } catch {
      reply.code(400);
      return { error: 'apiUrl must be a valid URL.' };
    }

    const session = getOrCreateSession(request, reply);

    const headers = {
      accept: 'application/json',
      cookie: session.cookies,
    };

    const requestInit = {
      method: request.method,
      headers,
    };

    if (request.method === 'GET') {
      addParams(target.searchParams, { format: 'json', ...params });
    } else {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      const formBody = new URLSearchParams();
      addParams(formBody, { format: 'json', ...params });
      requestInit.body = formBody;
    }

    let upstream;
    try {
      upstream = await fetch(target, requestInit);
    } catch (error) {
      request.log.error({ error }, 'Failed to reach MediaWiki API');
      reply.code(502);
      return { error: 'Unable to reach upstream MediaWiki API.' };
    }

    const setCookies = getSetCookies(upstream.headers);
    session.cookies = mergeSetCookies(session.cookies, setCookies);

    const responseText = await upstream.text();
    const contentType = upstream.headers.get('content-type') ?? 'application/json';

    reply.code(upstream.status);
    reply.header('content-type', contentType);
    return responseText;
  },
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info(`API server listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
