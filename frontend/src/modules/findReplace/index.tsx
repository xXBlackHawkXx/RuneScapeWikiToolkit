import { useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { applyFindReplace } from '@/core/utils/text';
import { Button, Field, Row } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import { QueuePanel } from '@/shared/components/QueuePanel';
import type { ModuleDefinition } from '@/core/modules/types';

type Result = { title: string; status: string; detail: string };

function FindReplaceView() {
  const { dryRun, wiki, settings, addLog, queue } = useAppContext();
  const [pattern, setPattern] = useState('');
  const [replace, setReplace] = useState('');
  const [pages, setPages] = useState('Zamorak\nSaradomin\nGuthix');
  const [summary, setSummary] = useState('Automated find & replace via RS3 Wiki Toolkit');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const enqueue = () => {
    const pageTitles = pages.split('\n').map((value) => value.trim()).filter(Boolean);
    const jobId = crypto.randomUUID();
    queue.enqueue({
      id: jobId,
      label: `Find & replace (${pageTitles.length} pages)`,
      run: async ({ signal, waitIfPaused, reportProgress }) => {
        const nextResults: Result[] = [];
        for (let index = 0; index < pageTitles.length; index += 1) {
          if (signal.aborted) {
            throw new Error('Job cancelled');
          }
          await waitIfPaused();
          const title = pageTitles[index];
          const page = await wiki.getPage(title);
          const source = page.revisions?.[0]?.slots?.main?.content ?? '';
          const transformed = applyFindReplace(source, pattern, replace, useRegex, caseSensitive);
          if (transformed.matches === 0) {
            nextResults.push({ title, status: 'skipped', detail: 'Pattern not found.' });
          } else if (dryRun) {
            nextResults.push({ title, status: 'simulated', detail: `Would replace ${transformed.matches} occurrence(s).` });
          } else {
            await wiki.edit({ title, text: transformed.text, summary: `${settings.summaryPrefix} ${summary}`.trim() });
            nextResults.push({ title, status: 'edited', detail: `Replaced ${transformed.matches} occurrence(s).` });
          }
          setResults([...nextResults]);
          reportProgress(index + 1, pageTitles.length, title);
          await wiki.delay();
        }
        addLog({
          tool: 'find-replace',
          action: dryRun ? 'Simulate' : 'Execute',
          dryRun,
          summary: `Processed ${pageTitles.length} pages`,
          status: 'completed',
          executionLog: nextResults.map((result) => `${result.title}: ${result.status} - ${result.detail}`),
        });
      },
    }, pageTitles.length);
  };

  return (
    <div className="module-stack">
      <Panel title="Search Parameters" icon="⌕">
        <Row>
          <Field label="Find pattern"><input value={pattern} onChange={(event) => setPattern(event.target.value)} /></Field>
          <Field label="Replace with"><input value={replace} onChange={(event) => setReplace(event.target.value)} /></Field>
        </Row>
        <Row>
          <label className="checkbox"><input type="checkbox" checked={useRegex} onChange={(event) => setUseRegex(event.target.checked)} /> Use regex</label>
          <label className="checkbox"><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /> Case sensitive</label>
        </Row>
      </Panel>
      <Panel title="Target Pages" icon="⊞">
        <Field label="Pages"><textarea rows={6} value={pages} onChange={(event) => setPages(event.target.value)} /></Field>
        <Field label="Edit summary"><input value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
        <div className="button-row"><Button variant="gold" onClick={enqueue} disabled={!pattern}>Queue run</Button></div>
      </Panel>
      <QueuePanel />
      <Panel title="Results" icon="✦">
        {results.length === 0 ? <div className="muted">No results yet.</div> : null}
        {results.map((result) => <div key={`${result.title}-${result.status}`} className="result-row"><strong>{result.title}</strong><span>{result.status}</span><div className="muted small">{result.detail}</div></div>)}
      </Panel>
    </div>
  );
}

export const FindReplaceModule: ModuleDefinition = {
  id: 'find-replace',
  name: 'Find & Replace',
  description: 'Find matching text or regex patterns and replace them across selected pages.',
  icon: '⌕',
  group: 'Editing',
  badge: 'EDIT',
  component: FindReplaceView,
};
