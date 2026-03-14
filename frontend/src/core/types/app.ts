export type AppSettings = {
  apiUrl: string;
  username: string;
  password: string;
  oathToken: string;
  requestDelayMs: number;
  bot: boolean;
  minor: boolean;
  summaryPrefix: string;
  userAgent: string;
};

export type AppLogEntry = {
  id: string;
  timestamp: string;
  tool: string;
  action: string;
  dryRun?: boolean;
  summary: string;
  status: 'running' | 'completed' | 'error';
  details?: string;
  executionLog?: string[];
};

export const DEFAULT_SETTINGS: AppSettings = {
  apiUrl: 'https://runescape.wiki/api.php',
  username: '',
  password: '',
  oathToken: '',
  requestDelayMs: 500,
  bot: true,
  minor: false,
  summaryPrefix: '[wiki-toolkit]',
  userAgent: 'RS3 Wiki Toolkit/0.2.0',
};

