import { useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { addCategoryTag, removeCategoryTag } from '@/core/utils/text';
import { Button, Field, Row } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import { QueuePanel } from '@/shared/components/QueuePanel';
import type { ModuleDefinition } from '@/core/modules/types';

function CategoryManagerView() {
  const { dryRun, wiki, settings, addLog, queue } = useAppContext();
  const [action, setAction] = useState<'add' | 'remove'>('add');
  const [category, setCategory] = useState('Category:God Wars Dungeon');
  const [pages, setPages] = useState('Dragon scimitar\nDragon longsword');
  const [summary, setSummary] = useState('Category operation via RS3 Wiki Toolkit');
  const [results, setResults] = useState<string[]>([]);

  const enqueue = () => {
    const titles = pages.split('\n').map((item) => item.trim()).filter(Boolean);
    queue.enqueue({
      id: crypto.randomUUID(),
      label: `Category ${action} (${titles.length} pages)`,
      run: async ({ signal, waitIfPaused, reportProgress }) => {
        const nextResults: string[] = [];
        for (let index = 0; index < titles.length; index += 1) {
          if (signal.aborted) {
            throw new Error('Job cancelled');
          }
          await waitIfPaused();
          const title = titles[index];
          const page = await wiki.getPage(title);
          const source = page.revisions?.[0]?.slots?.main?.content ?? '';
          const updated = action === 'add' ? addCategoryTag(source, category) : removeCategoryTag(source, category);
          if (!dryRun) {
            await wiki.edit({ title, text: updated, summary: `${settings.summaryPrefix} ${summary}`.trim() });
          }
          nextResults.push(`${dryRun ? 'Simulated' : 'Updated'} ${title}`);
          setResults([...nextResults]);
          reportProgress(index + 1, titles.length, title);
          await wiki.delay();
        }
        addLog({
          tool: 'category-manager',
          action: `Category ${action}`,
          dryRun,
          summary: `Processed ${titles.length} pages`,
          status: 'completed',
          executionLog: nextResults,
        });
      },
    }, titles.length);
  };

  return (
    <div className="module-stack">
      <Panel title="Category Operation" icon="⊟">
        <Row>
          <Field label="Action">
            <select value={action} onChange={(event) => setAction(event.target.value as 'add' | 'remove')}>
              <option value="add">Add category</option>
              <option value="remove">Remove category</option>
            </select>
          </Field>
          <Field label="Category"><input value={category} onChange={(event) => setCategory(event.target.value)} /></Field>
        </Row>
        <Field label="Pages"><textarea rows={6} value={pages} onChange={(event) => setPages(event.target.value)} /></Field>
        <Field label="Edit summary"><input value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
        <div className="button-row"><Button variant="gold" onClick={enqueue}>Queue category job</Button></div>
      </Panel>
      <QueuePanel />
      <Panel title="Results" icon="✦">{results.map((line) => <div key={line} className="result-row">{line}</div>)}</Panel>
    </div>
  );
}

export const CategoryManagerModule: ModuleDefinition = {
  id: 'category-manager',
  name: 'Category Manager',
  description: 'Bulk add or remove category tags across a set of pages.',
  icon: '⊟',
  group: 'Managing',
  badge: 'MANAGE',
  component: CategoryManagerView,
};
