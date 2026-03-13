import { useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { Button, Field, Row } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import { QueuePanel } from '@/shared/components/QueuePanel';
import type { ModuleDefinition } from '@/core/modules/types';

type EditMode = 'append' | 'prepend' | 'replace-section' | 'new-page';
type SourceMode = 'manual' | 'category' | 'search' | 'linked';

function replaceNamedSection(source: string, sectionHeading: string, replacement: string) {
  const escaped = sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^==\\s*${escaped}\\s*==[\\s\\S]*?)(?=^==|$)`, 'im');
  return source.replace(regex, `== ${sectionHeading} ==\n${replacement.trim()}\n`);
}

function MassEditView() {
  const { dryRun, wiki, settings, addLog, queue } = useAppContext();
  const [mode, setMode] = useState<EditMode>('append');
  const [content, setContent] = useState('== See also ==\n* [[RuneScape Wiki]]');
  const [section, setSection] = useState('See also');
  const [sourceMode, setSourceMode] = useState<SourceMode>('manual');
  const [manualPages, setManualPages] = useState('Grand Exchange\nLumbridge\nFalador');
  const [sourceQuery, setSourceQuery] = useState('Category:Monsters');
  const [summary, setSummary] = useState('Mass edit via RS3 Wiki Toolkit');
  const [results, setResults] = useState<string[]>([]);

  async function resolvePages() {
    if (sourceMode === 'manual') return manualPages.split('\n').map((item) => item.trim()).filter(Boolean);
    if (sourceMode === 'category') return wiki.getCategoryMembers(sourceQuery);
    if (sourceMode === 'search') return (await wiki.searchPages(sourceQuery)).map((item) => item.title);
    if (sourceMode === 'linked') return (await wiki.getPage(sourceQuery)).links?.map((link) => link.title) ?? [];
    return [];
  }

  const enqueue = async () => {
    const pageTitles = await resolvePages();
    queue.enqueue({
      id: crypto.randomUUID(),
      label: `Mass edit (${pageTitles.length} pages)`,
      run: async ({ signal, waitIfPaused, reportProgress }) => {
        const nextResults: string[] = [];
        for (let index = 0; index < pageTitles.length; index += 1) {
          if (signal.aborted) {
            throw new Error('Job cancelled');
          }
          await waitIfPaused();
          const title = pageTitles[index];
          const page = await wiki.getPage(title);
          const source = page.revisions?.[0]?.slots?.main?.content ?? '';
          let targetText = source;
          if (mode === 'append') targetText = `${source.trimEnd()}\n${content}\n`;
          if (mode === 'prepend') targetText = `${content}\n${source}`;
          if (mode === 'replace-section') targetText = replaceNamedSection(source, section, content);
          if (mode === 'new-page') targetText = content;
          if (!dryRun) {
            await wiki.edit({ title, text: targetText, summary: `${settings.summaryPrefix} ${summary}`.trim() });
          }
          nextResults.push(`${dryRun ? 'Simulated' : 'Edited'} ${title}`);
          setResults([...nextResults]);
          reportProgress(index + 1, pageTitles.length, title);
          await wiki.delay();
        }
        addLog({
          tool: 'mass-edit',
          action: dryRun ? 'Simulate' : 'Execute',
          dryRun,
          summary: `Mass edited ${pageTitles.length} pages`,
          status: 'completed',
          executionLog: nextResults,
        });
      },
    }, pageTitles.length);
  };

  return (
    <div className="module-stack">
      <Panel title="Edit Configuration" icon="⊞">
        <Row>
          <Field label="Mode">
            <select value={mode} onChange={(event) => setMode(event.target.value as EditMode)}>
              <option value="append">Append</option>
              <option value="prepend">Prepend</option>
              <option value="replace-section">Replace section</option>
              <option value="new-page">New page text</option>
            </select>
          </Field>
          {mode === 'replace-section' ? <Field label="Section"><input value={section} onChange={(event) => setSection(event.target.value)} /></Field> : null}
        </Row>
        <Field label="Wikitext"><textarea rows={8} value={content} onChange={(event) => setContent(event.target.value)} /></Field>
      </Panel>
      <Panel title="Targets" icon="⌕">
        <Row>
          <Field label="Source">
            <select value={sourceMode} onChange={(event) => setSourceMode(event.target.value as SourceMode)}>
              <option value="manual">Manual list</option>
              <option value="category">Category members</option>
              <option value="search">Search results</option>
              <option value="linked">Linked pages from a page</option>
            </select>
          </Field>
          <Field label={sourceMode === 'manual' ? 'Manual list' : 'Query / title'}>
            {sourceMode === 'manual'
              ? <textarea rows={6} value={manualPages} onChange={(event) => setManualPages(event.target.value)} />
              : <input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} />}
          </Field>
        </Row>
        <Field label="Edit summary"><input value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
        <div className="button-row"><Button variant="gold" onClick={() => void enqueue()}>Queue mass edit</Button></div>
      </Panel>
      <QueuePanel />
      <Panel title="Execution log" icon="☰">
        {results.map((line) => <div key={line} className="result-row">{line}</div>)}
      </Panel>
    </div>
  );
}

export const MassEditModule: ModuleDefinition = {
  id: 'mass-edit',
  name: 'Mass Edit',
  description: 'Apply the same wikitext change to many pages from a list, search, category, or links.',
  icon: '⊞',
  group: 'Editing',
  badge: 'EDIT',
  component: MassEditView,
};
