const DEFAULT_SECTION = 'General';

const ACTION_PATTERNS = [
  { type: 'fixed', regex: /\b(fix(?:ed|es)?|resolved|corrected|addressed)\b/i },
  { type: 'added', regex: /\b(add(?:ed|s|ing)?|introduc(?:ed|es|ing)|new)\b/i },
  { type: 'removed', regex: /\b(remove(?:d|s|ing)?|deleted|retired)\b/i },
  { type: 'buffed', regex: /\b(increase(?:d|s|ing)?|boost(?:ed|s|ing)?|improv(?:ed|es|ing)|enhanc(?:ed|es|ing))\b/i },
  { type: 'nerfed', regex: /\b(reduce(?:d|s|ing)?|decrease(?:d|s|ing)?|lower(?:ed|s|ing)|nerf(?:ed|s|ing))\b/i },
  { type: 'changed', regex: /\b(change(?:d|s|ing)?|adjust(?:ed|s|ing)?|update(?:d|s|ing)?|rework(?:ed|s|ing))\b/i },
] as const;

const KNOWN_ALIASES: Record<string, string> = {
  ge: 'Grand Exchange',
  xp: 'Experience',
  pvm: 'Player versus Monster',
  pvp: 'Player versus Player',
  rs: 'RuneScape',
};

type ChangeAction = (typeof ACTION_PATTERNS)[number]['type'];
type Confidence = 'high' | 'medium' | 'low';

type ParsePayload = {
  parse?: {
    title?: string;
    text?: { '*': string };
  };
};

type QueryPayload = {
  query?: {
    pages?: Array<{
      title?: string;
      missing?: boolean;
      revisions?: Array<{
        timestamp?: string;
        content?: string;
      }>;
    }>;
  };
};

type SearchPayload = {
  query?: {
    search?: Array<{
      title?: string;
    }>;
  };
};

type LinkedEntity = {
  page: string;
  display: string;
};

type ParsedChange = {
  section: string;
  raw: string;
  summary: string;
  entities: LinkedEntity[];
  subject: string;
  action: ChangeAction;
  valueChange: string;
  location: string;
};

type NormalizedChange = ParsedChange & {
  subjectCanonical: string;
  subjectConfidence: Confidence;
  subjectReason?: string;
  locationCanonical: string;
  locationConfidence: Confidence;
  locationReason?: string;
  suggestedPage: string;
  suggestedPageConfidence: Confidence;
  suggestedPageReason: string;
};

export type PatchPipelineResult = {
  metadata: {
    releaseNoteUrl: string;
    sourceTitle: string;
    sourceTimestamp: string | null;
    extractedAt: string;
    totalChanges: number;
  };
  changes: NormalizedChange[];
  artifacts: {
    json: string;
    wikitext: string;
    needsReview: string;
  };
};

function decodeHtmlEntities(input: string) {
  if (typeof document === 'undefined') {
    return input;
  }
  const node = document.createElement('textarea');
  node.innerHTML = input;
  return node.value;
}

function stripHtml(html: string) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function htmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(match?.[1]?.trim() ?? 'RuneScape Update');
}

function extractArticleTitleFromHtml(html: string) {
  const headline =
    html.match(/<h1[^>]*id=['"]article-title['"][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    html.match(/<h1[^>]*class=['"][^'"]*c-news-article__title[^'"]*['"][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    html.match(/property=['"]og:title['"][^>]*content=['"]([^'"]+)['"]/i)?.[1] ||
    '';

  const normalized = decodeHtmlEntities(String(headline).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  return normalized || htmlTitle(html);
}

function extractPublishedDateFromHtml(html: string) {
  const timeMatch = html.match(/<time[^>]*datetime=['"]([^'"]+)['"]/i);
  if (timeMatch?.[1]) {
    return timeMatch[1];
  }
  return null;
}

function formatPatchDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function stripWikiMarkup(text: string) {
  return text
    .replace(/<ref[^>]*>.*?<\/ref>/gi, '')
    .replace(/<ref[^/>]*\/>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\{\{!\}\}/g, '|')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

function parseSourceUrl(urlValue: string) {
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error('Release note URL must be valid.');
  }

  const isWiki = parsed.hostname.endsWith('runescape.wiki');
  const isSecureNews = parsed.hostname === 'secure.runescape.com' && (
    parsed.pathname.startsWith('/m=news/') ||
    parsed.pathname === '/m=news' ||
    parsed.search.includes('m=news')
  );

  return { parsed, isWiki, isSecureNews };
}


function backendFetchEndpoint() {
  const configuredBackendUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  const proxyBase = (import.meta.env.DEV ? '' : (configuredBackendUrl || '')).replace(/\/$/, '');

  if (!import.meta.env.DEV && !configuredBackendUrl) {
    throw new Error('Missing VITE_BACKEND_URL in this production build. Configure it to your backend /api URL.');
  }

  return `${proxyBase}/api/fetch-page`;
}

async function fetchHtmlViaBackend(targetUrl: string) {
  const endpoint = new URL(backendFetchEndpoint(), window.location.origin);
  endpoint.searchParams.set('url', targetUrl);

  const response = await fetch(endpoint, {
    credentials: 'include',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Backend fetch failed (${response.status}): ${message || 'Unknown error'}`);
  }

  return response.text();
}
function wikiTitleFromUrl(urlValue: URL) {
  const path = urlValue.pathname;
  if (path.startsWith('/w/')) {
    return decodeURIComponent(path.slice(3));
  }
  if (path.startsWith('/wiki/')) {
    return decodeURIComponent(path.slice(6));
  }
  throw new Error('Could not infer wiki page title from URL. Expected /w/ or /wiki/ path.');
}

async function fetchMediaWikiJson<T>(apiUrl: string, query: Record<string, string | number>) {
  const params = new URLSearchParams({
    format: 'json',
    origin: '*',
    ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
  });
  const response = await fetch(`${apiUrl}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`MediaWiki request failed: ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error?.info) {
    throw new Error(payload.error.info);
  }
  return payload as T;
}

function parsePatchDetailsBlock(blockHtml: string) {
  const lines = ['== Patch Notes =='];
  let currentSection = 'General';
  let sectionEmitted = false;
  let hasBullet = false;

  const tokenRegex = /<h3[^>]*>[\s\S]*?<\/h3>|<li\b[^>]*>[\s\S]*?<\/li>/gi;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(blockHtml)) !== null) {
    const token = match[0];

    if (/^<h3/i.test(token)) {
      currentSection = stripHtml(token) || 'General';
      lines.push(`=== ${currentSection} ===`);
      sectionEmitted = true;
      continue;
    }

    const text = stripHtml(token);
    if (!text) {
      continue;
    }

    if (!sectionEmitted) {
      lines.push(`=== ${currentSection} ===`);
      sectionEmitted = true;
    }

    lines.push(`* ${text}`);
    hasBullet = true;
  }

  return hasBullet ? lines.join('\n') : '';
}

function extractPatchNotesFromWikiHtml(pageHtml: string) {
  const headingMatch = pageHtml.match(/<h2[^>]*>[\s\S]*?id="Patch_Notes"[\s\S]*?<\/h2>/i);
  if (!headingMatch || headingMatch.index === undefined) {
    return '';
  }

  const afterPatchHeading = pageHtml.slice(headingMatch.index + headingMatch[0].length);
  const nextH2Index = afterPatchHeading.search(/<h2\b/i);
  const patchHtml = nextH2Index >= 0 ? afterPatchHeading.slice(0, nextH2Index) : afterPatchHeading;
  return parsePatchDetailsBlock(patchHtml);
}

function extractPatchNotesFromSecureHtml(pageHtml: string) {
  const detailsRegex = /<details\b[^>]*>[\s\S]*?<\/details>/gi;
  const blocks = pageHtml.match(detailsRegex) ?? [];

  for (const block of blocks) {
    const summary = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? '';
    if (!/patch\s*notes?/i.test(stripHtml(summary))) {
      continue;
    }

    const inner = block
      .replace(/^[\s\S]*?<summary[^>]*>[\s\S]*?<\/summary>/i, '')
      .replace(/<\/details>\s*$/i, '');

    const parsed = parsePatchDetailsBlock(inner);
    if (parsed) {
      return parsed;
    }
  }

  return '';
}

function parseLinkedEntities(text: string) {
  const entities: LinkedEntity[] = [];
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    entities.push({
      page: match[1].trim(),
      display: (match[2] ?? match[1]).trim(),
    });
  }

  return entities;
}

function classifyAction(text: string): ChangeAction {
  for (const pattern of ACTION_PATTERNS) {
    if (pattern.regex.test(text)) {
      return pattern.type;
    }
  }
  return 'changed';
}

function extractValueChange(text: string) {
  const percentage = text.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  if (percentage) {
    return `${percentage[1]}%`;
  }

  const range = text.match(/\bfrom\s+([^.,;]+?)\s+to\s+([^.,;]+)/i);
  if (range) {
    return `from ${range[1].trim()} to ${range[2].trim()}`;
  }

  const numeric = text.match(/([+-]?\d+(?:\.\d+)?)/);
  return numeric ? numeric[1] : '';
}

function extractLikelyLocation(text: string) {
  const match = text.match(
    /\b(?:in|at|on|within|inside|near|around)\s+(?:the\s+)?([A-Z][A-Za-z'\-]*(?:\s+(?:of|the|and|to|for|in|on|at|[A-Z][A-Za-z'\-]*)){0,8})/,
  );
  return match ? match[1].trim() : '';
}

function parseSectionAndBullets(wikitext: string) {
  const lines = wikitext.split(/\r?\n/);
  const changes: ParsedChange[] = [];
  let currentSection = DEFAULT_SECTION;

  for (const line of lines) {
    const heading = line.match(/^(={2,})\s*(.*?)\s*\1\s*$/);
    if (heading) {
      currentSection = heading[2].trim() || DEFAULT_SECTION;
      continue;
    }

    const bullet = line.match(/^\*+\s+(.*)$/);
    if (!bullet) {
      continue;
    }

    const raw = bullet[1].trim();
    const entities = parseLinkedEntities(raw);
    const summary = stripWikiMarkup(raw);

    changes.push({
      section: currentSection,
      raw,
      summary,
      entities,
      subject: entities[0]?.page ?? summary.split(/[.,;:]/)[0] ?? '',
      action: classifyAction(summary),
      valueChange: extractValueChange(summary),
      location: extractLikelyLocation(summary),
    });
  }

  return changes;
}

function createAliasMap(changes: ParsedChange[]) {
  const aliasMap = new Map<string, string>(Object.entries(KNOWN_ALIASES));

  for (const change of changes) {
    for (const entity of change.entities) {
      aliasMap.set(normalizeLabel(entity.display), entity.page);
      aliasMap.set(normalizeLabel(entity.page), entity.page);
    }
  }

  return aliasMap;
}

function normalizeEntity(raw: string, aliasMap: Map<string, string>) {
  if (!raw) {
    return { canonical: '', confidence: 'low' as Confidence, reason: 'No value present to normalize.' };
  }

  const normalizedKey = normalizeLabel(raw);
  const mapped = aliasMap.get(normalizedKey);
  if (mapped) {
    return { canonical: mapped, confidence: 'high' as Confidence };
  }

  if (/^[a-z0-9 '\-]+$/i.test(raw)) {
    const titleCased = raw
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

    return {
      canonical: titleCased,
      confidence: 'medium' as Confidence,
      reason: 'Inferred by title-casing; not matched to known aliases or wikilinks.',
    };
  }

  return {
    canonical: raw,
    confidence: 'low' as Confidence,
    reason: 'Could not confidently normalize this entity.',
  };
}

function toWikiCell(value: string) {
  return String(value ?? '').replace(/\|/g, '{{!}}').replace(/\n/g, '<br />');
}

function maybeWikiLink(value: string) {
  if (!value) {
    return '';
  }
  if (value.includes('[[')) {
    return value;
  }
  return `[[${value}]]`;
}

function ulTypeForSection(section: string) {
  return section.trim().toLowerCase().startsWith('hotfix') ? 'hotfix' : 'patch';
}

function buildPatchSnippet(updateLabel: string, dateLabel: string, change: NormalizedChange) {
  const type = ulTypeForSection(change.section);
  const line = `** ${change.summary}`;
  return `* {{UL|type=${type}|update=${updateLabel}|date=${dateLabel}}}\n${line}`;
}

function cleanUpdateTitle(sourceTitle: string) {
  return sourceTitle
    .replace(/\s+-\s+News\s+-\s+RuneScape\s+-\s+RuneScape\s*$/i, '')
    .trim();
}

function generateWikitext(params: {
  releaseNoteUrl: string;
  sourceTitle: string;
  extractedAt: string;
  patchDateLabel: string;
  normalizedChanges: NormalizedChange[];
}) {
  const { releaseNoteUrl, sourceTitle, extractedAt, patchDateLabel, normalizedChanges } = params;

  const updateLabel = cleanUpdateTitle(sourceTitle) || sourceTitle;
  const safeDate = patchDateLabel || formatPatchDate(extractedAt) || '';

  const lines: string[] = [];
  lines.push('== Automated patch note extraction ==');
  lines.push(`* Source: [${releaseNoteUrl} ${sourceTitle}]`);
  lines.push(`* Extracted: ${extractedAt}`);

  for (const change of normalizedChanges) {
    lines.push(buildPatchSnippet(updateLabel, safeDate, change));
  }

  return lines.join('\n');
}

function createReviewList(normalizedChanges: NormalizedChange[]) {
  const lines: string[] = [];
  let index = 1;

  for (const change of normalizedChanges) {
    const subjectNeedsReview = change.subjectConfidence !== 'high';
    const locationNeedsReview = Boolean(change.location) && change.locationConfidence !== 'high';

    if (!subjectNeedsReview && !locationNeedsReview) {
      continue;
    }

    lines.push(`${index}. [${change.section}] ${change.summary}`);
    if (subjectNeedsReview) {
      lines.push(`   - Subject: "${change.subject}" -> "${change.subjectCanonical}" (${change.subjectReason ?? 'Needs verification'})`);
    }
    if (locationNeedsReview) {
      lines.push(`   - Location: "${change.location}" -> "${change.locationCanonical}" (${change.locationReason ?? 'Needs verification'})`);
    }
    index += 1;
  }

  return lines.length > 0 ? lines.join('\n') : 'No review items. All entities matched with high confidence.';
}

async function fromRunescapeWiki(parsed: URL, releaseNoteUrl: string) {
  const title = wikiTitleFromUrl(parsed);
  const apiUrl = `${parsed.origin}/api.php`;

  const htmlPayload = await fetchMediaWikiJson<ParsePayload>(apiUrl, {
    action: 'parse',
    page: title,
    prop: 'text',
  });

  const parsedHtml = htmlPayload.parse?.text?.['*'] ?? '';
  const patchPseudoWikitext = extractPatchNotesFromWikiHtml(parsedHtml);

  if (patchPseudoWikitext) {
    return {
      sourceTitle: htmlPayload.parse?.title ?? title,
      sourceTimestamp: null,
      sourceWikitext: patchPseudoWikitext,
      releaseNoteUrl,
      suggestionApiUrl: apiUrl,
    };
  }

  const fallbackPayload = await fetchMediaWikiJson<QueryPayload>(apiUrl, {
    action: 'query',
    formatversion: 2,
    prop: 'revisions',
    rvprop: 'content|timestamp',
    titles: title,
  });

  const page = fallbackPayload.query?.pages?.[0];
  const revision = page?.revisions?.[0];
  const content = revision?.content;

  if (!content) {
    throw new Error('No wikitext content returned for this page.');
  }

  return {
    sourceTitle: page?.title ?? title,
    sourceTimestamp: revision?.timestamp ?? null,
    sourceWikitext: content,
    releaseNoteUrl,
    suggestionApiUrl: apiUrl,
  };
}

async function fromSecureRunescape(parsed: URL, releaseNoteUrl: string) {
  const html = await fetchHtmlViaBackend(parsed.toString());
  const wikitext = extractPatchNotesFromSecureHtml(html);

  if (!wikitext) {
    throw new Error('Could not find a "Patch Notes" section in the RuneScape.com update page.');
  }

  return {
    sourceTitle: extractArticleTitleFromHtml(html),
    sourceTimestamp: extractPublishedDateFromHtml(html),
    sourceWikitext: wikitext,
    releaseNoteUrl,
    suggestionApiUrl: 'https://runescape.wiki/api.php',
  };
}


async function fetchPatchNoteWikitext(params: { releaseNoteUrl: string }) {
  const { parsed, isWiki, isSecureNews } = parseSourceUrl(params.releaseNoteUrl);
  if (isWiki) {
    return fromRunescapeWiki(parsed, params.releaseNoteUrl);
  }
  if (isSecureNews) {
    return fromSecureRunescape(parsed, params.releaseNoteUrl);
  }

  throw new Error('Unsupported source URL. Use a runescape.wiki update URL or a secure.runescape.com news URL.');
}


function isLikelyTitleCandidate(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (text.length < 2 || text.length > 90) return false;
  if (/[%\n\r]/.test(text)) return false;
  const words = text.split(/\s+/).length;
  if (words > 10) return false;
  if (/^(fixed|resolved|players|abilities|some|made|normalised|the\s+ui)/i.test(text)) return false;
  return true;
}

function extractTitleLikePhrases(summary: string) {
  const out: string[] = [];
  const quoted = [...summary.matchAll(/"([^"\n]{2,70})"/g)].map((m) => m[1].trim());
  out.push(...quoted);

  const prepositional = [
    ...summary.matchAll(
      /\b(?:in|at|on|within|inside|near|around|from|to)\s+(?:the\s+)?([A-Z][A-Za-z'\-]*(?:\s+(?:of|the|and|to|for|in|on|at|[A-Z][A-Za-z'\-]*)){0,8})/g,
    ),
  ].map((m) => m[1].trim());
  out.push(...prepositional);

  const capitalized = [...summary.matchAll(/\b([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,4})\b/g)]
    .map((m) => m[1].trim());

  const blacklist = new Set(['Players', 'Fixed', 'Resolved', 'Some', 'General', 'Hotfixed', 'Patch Notes', 'RuneScape']);

  for (const phrase of capitalized) {
    if (!phrase || blacklist.has(phrase)) continue;
    out.push(phrase);
  }

  const seen = new Set<string>();
  return out.filter((v) => {
    const key = normalizeLabel(v);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateTitlesForChange(change: NormalizedChange) {
  const candidates: Array<{ title: string; confidence: Confidence; source: string }> = [];

  for (const entity of change.entities) {
    candidates.push({ title: entity.page, confidence: 'high', source: 'linked entity' });
  }

  if (isLikelyTitleCandidate(change.subjectCanonical)) {
    candidates.push({ title: change.subjectCanonical, confidence: change.subjectConfidence, source: 'normalized subject' });
  }

  if (isLikelyTitleCandidate(change.subject)) {
    candidates.push({ title: change.subject, confidence: 'low', source: 'raw subject' });
  }

  if (isLikelyTitleCandidate(change.locationCanonical)) {
    candidates.push({ title: change.locationCanonical, confidence: change.locationConfidence, source: 'normalized location' });
  }

  if (isLikelyTitleCandidate(change.location)) {
    candidates.push({ title: change.location, confidence: 'low', source: 'raw location' });
  }

  for (const phrase of extractTitleLikePhrases(change.summary)) {
    candidates.push({ title: phrase, confidence: 'medium', source: 'summary phrase' });
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalizeLabel(candidate.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolveTitle(apiUrl: string, title: string, cache: Map<string, { exists: boolean; resolvedTitle: string }>) {
  const key = normalizeLabel(title);
  const cached = cache.get(key);
  if (cached) return cached;

  const payload = await fetchMediaWikiJson<QueryPayload>(apiUrl, {
    action: 'query',
    formatversion: 2,
    titles: title,
    redirects: 1,
  });

  const page = payload.query?.pages?.[0];
  const result = {
    exists: Boolean(page && !page.missing),
    resolvedTitle: page?.title ?? title,
  };

  cache.set(key, result);
  return result;
}

async function resolveBySearch(apiUrl: string, phrase: string, cache: Map<string, { exists: boolean; resolvedTitle: string }>) {
  const cleaned = phrase.replace(/"/g, '').trim();
  if (!cleaned) return { exists: false, resolvedTitle: '' };

  const exactSearch = await fetchMediaWikiJson<SearchPayload>(apiUrl, {
    action: 'query',
    list: 'search',
    srsearch: 'intitle:"' + cleaned + '"',
    srlimit: 1,
  });

  const exactTitle = exactSearch.query?.search?.[0]?.title;
  if (exactTitle) {
    return resolveTitle(apiUrl, exactTitle, cache);
  }

  const broadSearch = await fetchMediaWikiJson<SearchPayload>(apiUrl, {
    action: 'query',
    list: 'search',
    srsearch: cleaned,
    srlimit: 1,
  });

  const broadTitle = broadSearch.query?.search?.[0]?.title;
  if (!broadTitle) return { exists: false, resolvedTitle: '' };
  return resolveTitle(apiUrl, broadTitle, cache);
}

async function applySuggestedPages(changes: NormalizedChange[], suggestionApiUrl: string) {
  const cache = new Map<string, { exists: boolean; resolvedTitle: string }>();

  return Promise.all(changes.map(async (change) => {
    const candidates = candidateTitlesForChange(change);

    for (const candidate of candidates) {
      const lookup = await resolveTitle(suggestionApiUrl, candidate.title, cache);
      if (lookup.exists) {
        return {
          ...change,
          suggestedPage: lookup.resolvedTitle,
          suggestedPageConfidence: candidate.confidence,
          suggestedPageReason: 'Matched ' + candidate.source + '.',
        };
      }

      const searched = await resolveBySearch(suggestionApiUrl, candidate.title, cache);
      if (searched.exists) {
        return {
          ...change,
          suggestedPage: searched.resolvedTitle,
          suggestedPageConfidence: 'low' as Confidence,
          suggestedPageReason: 'Found by search fallback from ' + candidate.source + '.',
        };
      }
    }

    return {
      ...change,
      suggestedPage: '',
      suggestedPageConfidence: 'low' as Confidence,
      suggestedPageReason: 'No confident existing page match found.',
    };
  }));
}

export async function runPatchNotePipeline(params: {
  releaseNoteUrl: string;
}): Promise<PatchPipelineResult> {
  const extractedAt = new Date().toISOString();
  const { sourceTitle, sourceTimestamp, sourceWikitext, releaseNoteUrl, suggestionApiUrl } = await fetchPatchNoteWikitext(params);

  const parsedChanges = parseSectionAndBullets(sourceWikitext);
  const aliasMap = createAliasMap(parsedChanges);

  const normalizedChanges: NormalizedChange[] = parsedChanges.map((change) => {
    const subject = normalizeEntity(change.subject, aliasMap);
    const location = normalizeEntity(change.location, aliasMap);

    return {
      ...change,
      subjectCanonical: subject.canonical,
      subjectConfidence: subject.confidence,
      subjectReason: subject.reason,
      locationCanonical: location.canonical,
      locationConfidence: location.confidence,
      locationReason: location.reason,
      suggestedPage: '',
      suggestedPageConfidence: 'low',
      suggestedPageReason: '',
    };
  });

  const changesWithSuggestions = await applySuggestedPages(normalizedChanges, suggestionApiUrl);

  const patchDateLabel = formatPatchDate(sourceTimestamp ?? extractedAt);

  const generatedWikitext = generateWikitext({
    releaseNoteUrl,
    sourceTitle,
    extractedAt,
    patchDateLabel,
    normalizedChanges: changesWithSuggestions,
  });

  const reviewText = createReviewList(changesWithSuggestions);

  const metadata = {
    releaseNoteUrl,
    sourceTitle,
    sourceTimestamp,
    extractedAt,
    totalChanges: changesWithSuggestions.length,
  };

  return {
    metadata,
    changes: changesWithSuggestions,
    artifacts: {
      json: JSON.stringify({ metadata, changes: changesWithSuggestions }, null, 2),
      wikitext: generatedWikitext,
      needsReview: reviewText,
    },
  };
}


export function createIndividualPatchSnippet(
  metadata: PatchPipelineResult['metadata'],
  change: PatchPipelineResult['changes'][number],
) {
  const date = formatPatchDate(metadata.sourceTimestamp ?? metadata.extractedAt) || '';
  const updateLabel = cleanUpdateTitle(metadata.sourceTitle) || metadata.sourceTitle;
  return buildPatchSnippet(updateLabel, date, change as NormalizedChange);
}

