import type { AppSettings } from '@/core/types/app';
import type { CompareResponse, MediaWikiEditRequest, MediaWikiPage, SearchResult } from './types';

export type MediaWikiClient = ReturnType<typeof createMediaWikiClient>;

export function createMediaWikiClient(getSettings: () => AppSettings) {
  let csrfToken: string | null = null;
  let loggedIn = false;
  const configuredBackendUrl = import.meta.env.VITE_BACKEND_URL;
  const proxyBase = (import.meta.env.DEV ? '/api' : (configuredBackendUrl || '/api')).replace(/\/$/, '');
  const proxyEndpoint = `${proxyBase}/mediawiki`;

  async function request<T>(params: Record<string, string | number | boolean | undefined>, init?: RequestInit) {
    const settings = getSettings();
    const method = init?.method ?? 'GET';
    const finalInit: RequestInit = {
      credentials: 'include',
      ...init,
      headers: {
        'Accept': 'application/json',
        ...init?.headers,
      },
    };

    if (method === 'GET') {
      const url = new URL(proxyEndpoint, window.location.origin);
      Object.entries({ apiUrl: settings.apiUrl, ...params }).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
      const response = await fetch(url, finalInit);
      if (!response.ok) {
        throw new Error(`MediaWiki request failed: ${response.status}`);
      }
      const json = await response.json();
      if (json.error) {
        throw new Error(json.error.info ?? 'Unknown MediaWiki error');
      }
      return json as T;
    }

    finalInit.body = JSON.stringify({
      apiUrl: settings.apiUrl,
      ...params,
    });
    finalInit.headers = {
      'Content-Type': 'application/json',
      ...finalInit.headers,
    };
    const response = await fetch(proxyEndpoint, finalInit);
    if (!response.ok) {
      throw new Error(`MediaWiki request failed: ${response.status}`);
    }
    const json = await response.json();
    if (json.error) {
      throw new Error(json.error.info ?? 'Unknown MediaWiki error');
    }
    return json as T;
  }

  async function getLoginToken() {
    const response = await request<{ query: { tokens: { logintoken: string } } }>({ action: 'query', meta: 'tokens', type: 'login' });
    return response.query.tokens.logintoken;
  }

  async function getCsrfToken(force = false) {
    if (csrfToken && !force) {
      return csrfToken;
    }
    const response = await request<{ query: { tokens: { csrftoken: string } } }>({ action: 'query', meta: 'tokens' });
    csrfToken = response.query.tokens.csrftoken;
    return csrfToken;
  }

  async function login() {
    const settings = getSettings();
    if (!settings.username || !settings.password) {
      throw new Error('Username and password are required.');
    }
    const token = await getLoginToken();

    const parseClientLoginFailure = (response: { status: string; message?: string; messagecode?: string }) =>
      response.messagecode ?? response.message ?? response.status;

    const tryClientLogin = async (params: Record<string, string>) => {
      const response = await request<{
        clientlogin: { status: string; message?: string; messagecode?: string };
      }>(params, { method: 'POST' });
      return response.clientlogin;
    };

    try {
      const response = await request<{ login: { result: string; reason?: string } }>(
        { action: 'login', lgname: settings.username, lgpassword: settings.password, lgtoken: token },
        { method: 'POST' },
      );
      if (response.login.result !== 'Success') {
        throw new Error(response.login.reason ?? `Login failed: ${response.login.result}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const requiresClientLogin =
        errorMessage.includes('not supported by "action=login"') ||
        errorMessage.includes('Special:ApiHelp/clientlogin');

      if (!requiresClientLogin) {
        throw error;
      }

      const firstStep = await tryClientLogin({
        action: 'clientlogin',
        username: settings.username,
        password: settings.password,
        logintoken: token,
        loginreturnurl: window.location.href,
      });

      if (firstStep.status === 'PASS') {
        loggedIn = true;
        await getCsrfToken(true);
        return true;
      }

      const requiresOath = firstStep.status === 'UI' && firstStep.messagecode === 'oathauth-auth-ui';
      if (requiresOath) {
        const oathToken = settings.oathToken.trim();
        if (!oathToken) {
          throw new Error('Login requires 2FA. Enter your current 2FA code in Settings and retry.');
        }

        const secondStep = await tryClientLogin({
          action: 'clientlogin',
          username: settings.username,
          password: settings.password,
          logintoken: token,
          loginreturnurl: window.location.href,
          logincontinue: '1',
          OATHToken: oathToken,
        });

        if (secondStep.status !== 'PASS') {
          throw new Error(`Login failed: ${parseClientLoginFailure(secondStep)}`);
        }

        loggedIn = true;
        await getCsrfToken(true);
        return true;
      }

      throw new Error(`Login failed: ${parseClientLoginFailure(firstStep)}`);
    }

    loggedIn = true;
    await getCsrfToken(true);
    return true;
  }
  async function ensureLogin() {
    if (!loggedIn) {
      await login();
    }
  }

  async function getPage(title: string) {
    const response = await request<{ query: { pages: Record<string, MediaWikiPage> } }>({
      action: 'query',
      prop: 'revisions|categories|links|extlinks',
      rvprop: 'ids|timestamp|content',
      rvslots: 'main',
      titles: title,
      cllimit: 'max',
      pllimit: 'max',
      ellimit: 'max',
      redirects: true,
    });
    return Object.values(response.query.pages)[0];
  }

  async function getPages(titles: string[]) {
    const response = await request<{ query: { pages: Record<string, MediaWikiPage> } }>({
      action: 'query',
      prop: 'revisions|categories|links|extlinks',
      rvprop: 'ids|timestamp|content',
      rvslots: 'main',
      titles: titles.join('|'),
      cllimit: 'max',
      pllimit: 'max',
      ellimit: 'max',
      redirects: true,
    });
    return Object.values(response.query.pages);
  }

  async function searchPages(query: string, limit = 50) {
    const response = await request<{ query: { search: SearchResult[] } }>({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: limit,
      srprop: 'snippet',
    });
    return response.query.search;
  }

  async function getCategoryMembers(category: string, limit = 200) {
    const title = category.startsWith('Category:') ? category : `Category:${category}`;
    const response = await request<{ query: { categorymembers: Array<{ title: string }> } }>({
      action: 'query',
      list: 'categorymembers',
      cmtitle: title,
      cmlimit: limit,
    });
    return response.query.categorymembers.map((item) => item.title);
  }

  async function getDoubleRedirects(limit = 200) {
    const response = await request<{ query: { querypage: { results: Array<{ title: string }> } } }>({
      action: 'query',
      list: 'querypage',
      qppage: 'DoubleRedirects',
      qplimit: limit,
    });
    return response.query.querypage.results.map((item) => item.title);
  }

  async function getBacklinks(title: string, limit = 200) {
    const response = await request<{ query: { backlinks: Array<{ title: string }> } }>({
      action: 'query',
      list: 'backlinks',
      bltitle: title,
      bllimit: limit,
    });
    return response.query.backlinks.map((item) => item.title);
  }

  async function getTransclusions(template: string, limit = 200) {
    const title = template.startsWith('Template:') ? template : `Template:${template}`;
    const response = await request<{ query: { embeddedin: Array<{ title: string }> } }>({
      action: 'query',
      list: 'embeddedin',
      eititle: title,
      eilimit: limit,
    });
    return response.query.embeddedin.map((item) => item.title);
  }

  async function compare(title: string, fromRev: string, toRev: string) {
    const page = await getPage(title);
    const revisions = page.revisions ?? [];
    if (!revisions[0]?.revid) {
      throw new Error(`No revisions available for ${title}`);
    }
    const current = revisions[0].revid;
    const parent = revisions[0].parentid ?? revisions[0].revid;
    const fromrevid = fromRev === 'prev' ? parent : fromRev === 'cur' ? current : Number(fromRev);
    const torevid = toRev === 'cur' ? current : toRev === 'prev' ? parent : Number(toRev);
    const response = await request<{ compare: CompareResponse }>({
      action: 'compare',
      fromrev: fromrevid,
      torev: torevid,
      prop: 'diff',
    });
    return response.compare;
  }

  async function getPageSource(title: string) {
    const response = await request<{ query: { pages: Record<string, MediaWikiPage> } }>({
      action: 'query',
      prop: 'revisions',
      rvprop: 'ids|timestamp|content',
      rvslots: 'main',
      titles: title,
    });
    const page = Object.values(response.query.pages)[0];
    return {
      page,
      content: page.revisions?.[0]?.slots?.main?.content ?? '',
    };
  }

  async function resolveRedirectTarget(title: string) {
    const response = await request<{
      query: {
        pages: Record<string, MediaWikiPage>;
        redirects?: Array<{ from: string; to: string; tofragment?: string }>;
      };
    }>({
      action: 'query',
      titles: title,
      redirects: true,
    });
    const resolvedPage = Object.values(response.query.pages)[0];
    const redirect = response.query.redirects?.[0];
    return {
      redirected: Boolean(redirect),
      sourceTitle: redirect?.from ?? title,
      targetTitle: redirect?.to ?? resolvedPage.title,
      targetFragment: redirect?.tofragment,
      resolvedTitle: resolvedPage.title,
      missing: Boolean(resolvedPage.missing),
    };
  }

  async function edit(requestPayload: MediaWikiEditRequest) {
    await ensureLogin();
    const token = await getCsrfToken();
    const settings = getSettings();
    const response = await request<{ edit: { result: string; newrevid?: number; oldrevid?: number; nochange?: boolean } }>(
      {
        action: 'edit',
        title: requestPayload.title,
        token,
        text: requestPayload.text,
        appendtext: requestPayload.appendtext,
        prependtext: requestPayload.prependtext,
        summary: requestPayload.summary,
        bot: requestPayload.bot ?? settings.bot,
        minor: requestPayload.minor ?? settings.minor,
      },
      { method: 'POST' },
    );
    return response.edit;
  }

  async function testConnection() {
    const siteInfo = await request<{ query: { general: { sitename: string; server: string } } }>({ action: 'query', meta: 'siteinfo', siprop: 'general' });
    return siteInfo.query.general;
  }

  async function delay() {
    const ms = getSettings().requestDelayMs;
    if (ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  return {
    request,
    login,
    ensureLogin,
    getPage,
    getPages,
    searchPages,
    getCategoryMembers,
    getDoubleRedirects,
    getBacklinks,
    getTransclusions,
    compare,
    getPageSource,
    resolveRedirectTarget,
    edit,
    testConnection,
    delay,
  };
}



