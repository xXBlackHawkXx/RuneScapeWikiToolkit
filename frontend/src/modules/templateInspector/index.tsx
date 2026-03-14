import { useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { Button, Field, Row } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import type { ModuleDefinition } from '@/core/modules/types';

type Finding = { title: string; issues: string[] };

function inspectTemplateUsage(source: string, templateName: string) {
  const findings: string[] = [];
  const regex = new RegExp(`{{\\s*${templateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)}}`, 'i');
  const match = source.match(regex);
  if (!match) {
    findings.push('Template transclusion not found in source.');
    return findings;
  }
  const body = match[1] ?? '';
  const keys = Array.from(body.matchAll(/\|\s*([^=|]+)\s*=/g)).map((entry) => entry[1].trim());
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length > 0) findings.push(`Duplicate params: ${Array.from(new Set(duplicates)).join(', ')}`);
  if (!body.includes('=')) findings.push('No named parameters detected.');
  return findings.length > 0 ? findings : ['No obvious issues detected.'];
}

function TemplateInspectorView() {
  const { wiki, addLog } = useAppContext();
  const [template, setTemplate] = useState('Infobox Monster');
  const [scope, setScope] = useState<'transclusions' | 'manual'>('transclusions');
  const [manualPages, setManualPages] = useState('Abyssal demon\nGeneral Graardor');
  const [results, setResults] = useState<Finding[]>([]);

  const run = async () => {
    const pageTitles = scope === 'transclusions'
      ? await wiki.getTransclusions(template)
      : manualPages.split('\n').map((item) => item.trim()).filter(Boolean);
    const pages = await wiki.getPages(pageTitles.slice(0, 100));
    const nextResults = pages.map((page) => ({
      title: page.title,
      issues: inspectTemplateUsage(page.revisions?.[0]?.slots?.main?.content ?? '', template),
    }));
    setResults(nextResults);
    addLog({
      tool: 'template-inspector',
      action: 'Inspect template',
      dryRun: false,
      summary: `Inspected ${nextResults.length} pages`,
      status: 'completed',
      executionLog: nextResults.flatMap((item) => item.issues.map((issue) => `${item.title}: ${issue}`)),
    });
  };

  return (
    <div className="module-stack">
      <Panel title="Template Scope" icon="⊛">
        <Row>
          <Field label="Template name"><input value={template} onChange={(event) => setTemplate(event.target.value)} /></Field>
          <Field label="Source">
            <select value={scope} onChange={(event) => setScope(event.target.value as 'transclusions' | 'manual')}>
              <option value="transclusions">Embeddedin query</option>
              <option value="manual">Manual list</option>
            </select>
          </Field>
        </Row>
        {scope === 'manual' ? <Field label="Manual pages"><textarea rows={6} value={manualPages} onChange={(event) => setManualPages(event.target.value)} /></Field> : null}
        <div className="button-row"><Button variant="gold" onClick={() => void run()}>Inspect</Button></div>
      </Panel>
      <Panel title="Findings" icon="✦">
        {results.map((item) => (
          <div key={item.title} className="result-row">
            <strong>{item.title}</strong>
            {item.issues.map((issue) => <div key={issue} className="muted small">{issue}</div>)}
          </div>
        ))}
      </Panel>
    </div>
  );
}

export const TemplateInspectorModule: ModuleDefinition = {
  id: 'template-inspector',
  name: 'Template Inspector',
  description: 'Audit template usage to catch missing transclusions and parameter issues.',
  icon: '⊛',
  group: 'Auditing',
  badge: 'AUDIT',
  component: TemplateInspectorView,
};
