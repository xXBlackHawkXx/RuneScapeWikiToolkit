import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createMediaWikiClient, type MediaWikiClient } from '@/core/mediawiki/client';
import type { AppLogEntry, AppSettings } from '@/core/types/app';
import { DEFAULT_SETTINGS } from '@/core/types/app';
import { createPersistentState } from '@/core/utils/storage';
import { useJobQueueController } from '@/core/queue/useJobQueueController';

const settingsStore = createPersistentState<AppSettings>('rs3-toolkit:settings', DEFAULT_SETTINGS);
const logStore = createPersistentState<AppLogEntry[]>('rs3-toolkit:logs', []);

function sanitizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    password: '',
    oathToken: '',
  };
}

type AppContextValue = {
  settings: AppSettings;
  setSettings: (updater: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
  dryRun: boolean;
  setDryRun: (value: boolean | ((prev: boolean) => boolean)) => void;
  activeModuleId: string;
  setActiveModuleId: (id: string) => void;
  logEntries: AppLogEntry[];
  addLog: (entry: Omit<AppLogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  wiki: MediaWikiClient;
  queue: ReturnType<typeof useJobQueueController>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(() => sanitizeSettings(settingsStore.get()));
  const [logEntries, setLogEntries] = useState<AppLogEntry[]>(() => logStore.get());
  const [dryRun, setDryRun] = useState(true);
  const [activeModuleId, setActiveModuleId] = useState('find-replace');
  const queue = useJobQueueController();

  useEffect(() => settingsStore.set(sanitizeSettings(settings)), [settings]);
  useEffect(() => logStore.set(logEntries), [logEntries]);

  const setSettings: AppContextValue['setSettings'] = useCallback((updater) => {
    setSettingsState((prev) => (typeof updater === 'function' ? (updater as (prev: AppSettings) => AppSettings)(prev) : updater));
  }, []);

  const addLog = useCallback((entry: Omit<AppLogEntry, 'id' | 'timestamp'>) => {
    setLogEntries((prev) => [
      {
        ...entry,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  }, []);

  const clearLogs = useCallback(() => setLogEntries([]), []);

  const wiki = useMemo(() => createMediaWikiClient(() => settings), [settings]);

  const value = useMemo<AppContextValue>(
    () => ({ settings, setSettings, dryRun, setDryRun, activeModuleId, setActiveModuleId, logEntries, addLog, clearLogs, wiki, queue }),
    [settings, setSettings, dryRun, activeModuleId, logEntries, addLog, clearLogs, wiki, queue],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
}

