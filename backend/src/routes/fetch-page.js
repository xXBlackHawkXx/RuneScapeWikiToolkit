function isAllowedFetchHost(hostname) {
  return hostname === 'secure.runescape.com' || hostname.endsWith('.runescape.wiki') || hostname === 'runescape.wiki';
}

export function registerFetchPageRoutes(app) {
  app.get('/api/fetch-page', async (request, reply) => {
    const query = request.query && typeof request.query === 'object' ? request.query : {};
    const urlValue = query.url;

    if (!urlValue || typeof urlValue !== 'string') {
      reply.code(400);
      return { error: 'url is required and must be a string.' };
    }

    let target;
    try {
      target = new URL(urlValue);
    } catch {
      reply.code(400);
      return { error: 'url must be a valid URL.' };
    }

    if (target.protocol !== 'https:') {
      reply.code(400);
      return { error: 'Only https URLs are allowed.' };
    }

    if (!isAllowedFetchHost(target.hostname)) {
      reply.code(403);
      return { error: 'Target host is not allowed.' };
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        headers: { accept: 'text/html,application/xhtml+xml' },
        redirect: 'follow',
      });
    } catch (error) {
      request.log.error({ error, url: urlValue }, 'Failed to fetch page');
      reply.code(502);
      return { error: 'Unable to reach upstream page.' };
    }

    const html = await upstream.text();
    const contentType = upstream.headers.get('content-type') ?? 'text/html; charset=utf-8';
    reply.code(upstream.status);
    reply.header('content-type', contentType);
    return html;
  });
}
