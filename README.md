# RS3 Wiki Toolkit Monorepo

This repository is now split into two npm workspaces:

- `frontend` - Vite + React + TypeScript UI
- `backend` - Fastify API proxy for MediaWiki calls (Render target)

## Why this fixes CORS

The browser no longer calls MediaWiki directly. Instead:

1. Frontend calls the Fastify backend (`/api/mediawiki`)
2. Backend performs server-to-server requests to the wiki API
3. Backend keeps MediaWiki session cookies server-side and exposes only a secure app session cookie to the browser

## Local development

```bash
npm install
npm run dev:backend
npm run dev:frontend
```

- Frontend runs at `http://localhost:5173`
- Backend runs at `http://localhost:3000`
- Vite proxies `/api/*` to backend during local development

## Frontend environment

Create `frontend/.env` when deploying frontend separately:

```bash
VITE_BACKEND_URL=https://your-render-service.onrender.com/api
```

If omitted, frontend defaults to `/api` (ideal for local proxying).

## Backend environment (Render)

Set these environment variables on Render:

- `PORT` is provided by Render
- `FRONTEND_ORIGIN` = deployed frontend origin (for example `https://your-site.github.io`)
- Optional: `CORS_ORIGINS` comma-separated allowlist
- Optional: `SESSION_COOKIE_SAMESITE=none` (recommended for cross-site frontend/backend)
- Optional: `SESSION_COOKIE_SECURE=true`

## Render start command

Use workspace start from repo root:

```bash
npm run start:backend
```

or directly:

```bash
npm run start --workspace backend
```
