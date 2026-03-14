import { useMemo, useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { Button } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import type { ModuleDefinition } from '@/core/modules/types';

const TOOL_NAMES: Record<string, string> = {
  'find-replace': 'Find & Replace',
  'mass-edit': 'Mass Edit',
  'template-inspector': 'Template Inspector',
  'category-manager': 'Category Manager',
  'dead-link-scanner': 'Dead Link Scanner',
  'page-diff': 'Page Diff',
  'double-redirect-resolver': 'Double Redirect Resolver',
  settings: 'Settings',
};

function ActionLogView() {
  const { logEntries, clearLogs } = useAppContext();
  const [modeFilter, setModeFilter] = useState<'all' | 'dry' | 'live'>('all');
  const [toolFilter, setToolFilter] = useState('all');

  const tools = useMemo(
    () => [...new Set(logEntries.map((entry) => entry.tool))].sort((a, b) => a.localeCompare(b)),
    [logEntries],
  );

  const filteredEntries = useMemo(
    () => logEntries.filter((entry) => {
      const modeMatches = modeFilter === 'all' || (modeFilter === 'dry' ? entry.dryRun === true : entry.dryRun !== true);
      const toolMatches = toolFilter === 'all' || entry.tool === toolFilter;
      return modeMatches && toolMatches;
    }),
    [logEntries, modeFilter, toolFilter],
  );

  const exportLog = () => {
    const file = new Blob([JSON.stringify(logEntries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rs3-wiki-log-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="module-stack">
      <Panel title="Log Controls" icon="☰">
        <div className="form-row">
          <label className="field">
            <span className="field-label">Mode Filter</span>
            <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value as 'all' | 'dry' | 'live')}>
              <option value="all">All Entries</option>
              <option value="dry">Dry Run Only</option>
              <option value="live">Live Only</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Tool Filter</span>
            <select value={toolFilter} onChange={(event) => setToolFilter(event.target.value)}>
              <option value="all">All Tools</option>
              {tools.map((tool) => <option key={tool} value={tool}>{TOOL_NAMES[tool] ?? tool}</option>)}
            </select>
          </label>
        </div>
        <div className="button-row">
          <Button variant="gold" onClick={exportLog} disabled={logEntries.length === 0}>Export JSON</Button>
          <Button variant="danger" onClick={clearLogs} disabled={logEntries.length === 0}>Clear All</Button>
        </div>
        <div className="muted small">Showing {filteredEntries.length} of {logEntries.length} entries</div>
      </Panel>
      <Panel title="Action Log" icon="☰">
        {filteredEntries.length === 0 ? <div className="muted">No entries recorded for the selected filters.</div> : null}
        {filteredEntries.map((entry) => (
          <div key={entry.id} className="result-row">
            <div className="result-top"><strong>{TOOL_NAMES[entry.tool] ?? entry.tool}</strong><span className={`pill pill-${entry.status}`}>{entry.status}</span></div>
            <div>{entry.action}</div>
            <div className="muted small">{new Date(entry.timestamp).toLocaleString()}</div>
            <div className="muted small">{entry.summary}</div>
            {entry.details ? <div className="muted small">{entry.details}</div> : null}
            {entry.executionLog && entry.executionLog.length > 0 ? (
              <details className="action-log-details">
                <summary>Show execution log ({entry.executionLog.length} lines)</summary>
                <div className="action-log-lines">
                  {entry.executionLog.map((line, index) => <div key={`${entry.id}-line-${index}`} className="small">{line}</div>)}
                </div>
              </details>
            ) : null}
          </div>
        ))}
      </Panel>
    </div>
  );
}

export const ActionLogModule: ModuleDefinition = {
  id: 'action-log',
  name: 'Action Log',
  description: 'Review, filter, and export a history of toolkit actions and outcomes.',
  icon: '☰',
  group: 'System',
  component: ActionLogView,
};
