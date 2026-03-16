import { useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { DEFAULT_SETTINGS } from '@/core/types/app';
import { Button, Field } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import type { ModuleDefinition } from '@/core/modules/types';

function SettingsView() {
  const { settings, setSettings, wiki, addLog } = useAppContext();
  const [testResult, setTestResult] = useState<string>('');

  const update = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const testConnection = async () => {
    try {
      const info = await wiki.testConnection();
      setTestResult(`Connected to ${info.sitename} (${info.server})`);
      addLog({
        tool: 'settings',
        action: 'Test connection',
        dryRun: false,
        summary: 'Connection succeeded',
        status: 'completed',
        executionLog: [`Connected to ${info.sitename}`, `Server: ${info.server}`],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult(message);
      addLog({
        tool: 'settings',
        action: 'Test connection',
        dryRun: false,
        summary: 'Connection failed',
        status: 'error',
        details: message,
        executionLog: [message],
      });
    }
  };

  return (
    <div className="module-stack">
      <Panel title="Wiki Connection" icon="⚙">
        <Field label="API URL"><input value={settings.apiUrl} onChange={(event) => update('apiUrl', event.target.value)} /></Field>
        <Field label="Username / bot account"><input value={settings.username} onChange={(event) => update('username', event.target.value)} /></Field>
        <Field label="Password / bot password"><input type="password" value={settings.password} onChange={(event) => update('password', event.target.value)} /></Field>
        <Field label="2FA code (optional)"><input value={settings.oathToken} onChange={(event) => update('oathToken', event.target.value)} placeholder="123456" /></Field>
        <div className="muted small">Password and 2FA code are kept in memory only for this browser session and are never saved to local storage.</div>
        <Field label="Request delay (ms)"><input type="number" value={settings.requestDelayMs} onChange={(event) => update('requestDelayMs', Number(event.target.value))} /></Field>
        <Field label="Summary prefix"><input value={settings.summaryPrefix} onChange={(event) => update('summaryPrefix', event.target.value)} /></Field>
        <label className="checkbox"><input type="checkbox" checked={settings.bot} onChange={(event) => update('bot', event.target.checked)} /> Mark edits as bot</label>
        <label className="checkbox"><input type="checkbox" checked={settings.minor} onChange={(event) => update('minor', event.target.checked)} /> Mark edits as minor</label>
        <div className="button-row">
          <Button variant="gold" onClick={() => void testConnection()}>Test connection</Button>
          <Button variant="success" onClick={() => addLog({ tool: 'settings', action: 'Save settings', dryRun: false, summary: 'Settings saved locally', status: 'completed' })}>Save</Button>
          <Button variant="danger" onClick={() => setSettings(DEFAULT_SETTINGS)}>Reset defaults</Button>
        </div>
        {testResult ? <div className="muted">{testResult}</div> : null}
      </Panel>
    </div>
  );
}

export const SettingsModule: ModuleDefinition = {
  id: 'settings',
  name: 'Settings',
  description: 'Configure wiki connection details, default edit flags, and local toolkit behavior.',
  icon: '⚙',
  group: 'System',
  component: SettingsView,
};


