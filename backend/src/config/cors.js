export function parseAllowedOrigins() {
  const configured = [process.env.CORS_ORIGINS, process.env.FRONTEND_ORIGIN]
    .filter(Boolean)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const defaults = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  return new Set([...defaults, ...configured]);
}
