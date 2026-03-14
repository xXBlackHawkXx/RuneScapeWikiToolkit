import { useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { Button, Field, Row } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import type { ModuleDefinition } from '@/core/modules/types';

type LinkFinding = { title: string; findings: string[] };

function DeadLinkScannerView() {
  const { wiki, addLog } = useAppContext();
  const [scope, setScope] = useState<'category' | 'manual' | 'search'>('category');
  const [query, setQuery] = useState('Category:Items');
  const [manualPages, setManualPages] = useState('Abyssal whip\nDragon scimitar');
  const [findings, setFindings] = useState<LinkFinding[]>([]);

  async function resolveTitles() {
    if (scope === 'manual') return manualPages.split('\n').map((item) => item.trim()).filter(Boolean);
    if (scope === 'search') return (await wiki.searchPages(query)).map((item) => item.title);
    return wiki.getCategoryMembers(query);
  }

  const run = async () => {
    const titles = await resolveTitles();
    const pages = await wiki.getPages(titles.slice(0, 50));
    const next = await Promise.all(pages.map(async (page) => {
      const notes: string[] = [];
      const missingLinks = (page.links ?? []).filter((link) => !('exists' in link));
      if (missingLinks.length > 0) notes.push(`Missing internal links: ${missingLinks.slice(0, 6).map((link) => link.title).join(', ')}`);
      const backlinks = await wiki.getBacklinks(page.title, 20);
      if (backlinks.length === 0) notes.push('Potential orphan page: no backlinks found in sampled query.');
      const externalLinks = page.extlinks?.map((link) => link['*']) ?? [];
      const duplicateExternal = externalLinks.filter((link, index) => externalLinks.indexOf(link) !== index);
      if (duplicateExternal.length > 0) notes.push(`Duplicate external links: ${Array.from(new Set(duplicateExternal)).join(', ')}`);
      return { title: page.title, findings: notes.length > 0 ? notes : ['No obvious issues detected.'] };
    }));
    setFindings(next);
    addLog({
      tool: 'dead-link-scanner',
      action: 'Scan links',
      dryRun: false,
      summary: `Scanned ${next.length} pages`,
      status: 'completed',
      executionLog: next.flatMap((item) => item.findings.map((finding) => `${item.title}: ${finding}`)),
    });
  };

  return (
    <div className="module-stack">
      <Panel title="Scan Scope" icon="⊘">
        <Row>
          <Field label="Source">
            <select value={scope} onChange={(event) => setScope(event.target.value as 'category' | 'manual' | 'search')}>
              <option value="category">Category members</option>
              <option value="manual">Manual list</option>
              <option value="search">Search query</option>
            </select>
          </Field>
          <Field label="Query / category"><input value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
        </Row>
        {scope === 'manual' ? <Field label="Manual pages"><textarea rows={5} value={manualPages} onChange={(event) => setManualPages(event.target.value)} /></Field> : null}
        <div className="button-row"><Button variant="gold" onClick={() => void run()}>Scan</Button></div>
      </Panel>
      <Panel title="Findings" icon="✦">
        {findings.map((item) => (
          <div key={item.title} className="result-row">
            <strong>{item.title}</strong>
            {item.findings.map((finding) => <div key={finding} className="muted small">{finding}</div>)}
          </div>
        ))}
      </Panel>
    </div>
  );
}

export const DeadLinkScannerModule: ModuleDefinition = {
  id: 'dead-link-scanner',
  name: 'Dead Link Scanner',
  description: 'Scan pages for missing internal links, duplicate external links, and likely orphans.',
  icon: '⊘',
  group: 'Auditing',
  badge: 'AUDIT',
  component: DeadLinkScannerView,
};
