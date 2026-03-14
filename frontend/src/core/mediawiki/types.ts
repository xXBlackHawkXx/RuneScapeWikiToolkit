export type MediaWikiPage = {
  pageid?: number;
  ns: number;
  title: string;
  missing?: boolean;
  revisions?: Array<{ revid: number; parentid?: number; slots?: { main?: { content?: string } } }>;
  categories?: Array<{ title: string }>;
  links?: Array<{ title: string; exists?: string }>;
  extlinks?: Array<{ '*': string }>;
  redirect?: boolean;
};

export type MediaWikiEditRequest = {
  title: string;
  text?: string;
  appendtext?: string;
  prependtext?: string;
  summary: string;
  basetimestamp?: string;
  starttimestamp?: string;
  bot?: boolean;
  minor?: boolean;
};

export type CompareResponse = {
  fromrevid: number;
  torevid: number;
  '*': string;
};

export type SearchResult = {
  title: string;
  pageid: number;
  snippet: string;
};
