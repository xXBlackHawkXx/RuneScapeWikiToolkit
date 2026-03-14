import { useMemo, useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { Button, Field, Row } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import type { ModuleDefinition } from '@/core/modules/types';
import { generateDraftBundle, type GeneratedDraft } from './logic';

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ComponentGeneratorView() {
  const { wiki, addLog } = useAppContext();
  const [outfitInput, setOutfitInput] = useState('Desert Wanderer outfit');
  const [includeExisting, setIncludeExisting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outfitTitle, setOutfitTitle] = useState<string | null>(null);
  const [components, setComponents] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<GeneratedDraft[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<string>('');

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.title === selectedTitle) ?? drafts[0] ?? null,
    [drafts, selectedTitle],
  );

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const bundle = await generateDraftBundle(wiki, { outfitInput, includeExisting });
      setOutfitTitle(bundle.outfitTitle);
      setComponents(bundle.components);
      setDrafts(bundle.drafts);
      setSelectedTitle(bundle.drafts[0]?.title ?? '');
      addLog({
        tool: 'component-generator',
        action: 'Generate drafts',
        dryRun: true,
        summary: `Generated ${bundle.drafts.length} draft page(s) for ${bundle.outfitTitle}`,
        status: 'completed',
        executionLog: bundle.drafts.map((draft) => `${draft.kind}: ${draft.title}`),
      });
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : 'Unknown error while generating drafts.';
      setError(message);
      addLog({
        tool: 'component-generator',
        action: 'Generate drafts',
        dryRun: true,
        summary: message,
        status: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const downloadAll = () => {
    for (const draft of drafts) {
      downloadTextFile(draft.filename, draft.content);
    }
  };

  return (
    <div className="module-stack">
      <Panel title="Outfit Input" icon="✎">
        <Row>
          <Field label="Outfit title or URL">
            <input value={outfitInput} onChange={(event) => setOutfitInput(event.target.value)} />
          </Field>
        </Row>
        <label className="checkbox">
          <input type="checkbox" checked={includeExisting} onChange={(event) => setIncludeExisting(event.target.checked)} />
          Include existing component pages
        </label>
        <div className="button-row">
          <Button variant="gold" onClick={() => void run()} disabled={loading || !outfitInput.trim()}>
            {loading ? 'Generating...' : 'Generate Drafts'}
          </Button>
          <Button variant="ghost" onClick={downloadAll} disabled={drafts.length === 0}>Download All</Button>
        </div>
        {error ? <div className="error-text">{error}</div> : null}
        {outfitTitle ? <div className="muted small">Outfit: {outfitTitle}</div> : null}
      </Panel>

      <Panel title="Generated Files" icon="▤">
        {drafts.length === 0 ? <div className="muted">No drafts yet.</div> : null}
        {drafts.map((draft) => (
          <div key={draft.title} className="result-row">
            <div className="result-top">
              <strong>{draft.title}</strong>
              <span className="pill pill-completed">{draft.kind}</span>
            </div>
            <div className="muted small">{draft.filename}</div>
            <div className="button-row">
              <Button variant="ghost" onClick={() => setSelectedTitle(draft.title)}>Preview</Button>
              <Button variant="success" onClick={() => downloadTextFile(draft.filename, draft.content)}>Download</Button>
            </div>
          </div>
        ))}
      </Panel>

      <Panel title="Preview" icon="⌬">
        {components.length > 0 ? <div className="muted small" style={{ marginBottom: '8px' }}>Component candidates: {components.join(', ')}</div> : null}
        <Field label="Selected draft">
          <select value={selectedDraft?.title ?? ''} onChange={(event) => setSelectedTitle(event.target.value)}>
            {drafts.map((draft) => (
              <option key={draft.title} value={draft.title}>{draft.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Wikitext">
          <textarea rows={20} value={selectedDraft?.content ?? ''} readOnly />
        </Field>
      </Panel>
    </div>
  );
}

export const ComponentGeneratorModule: ModuleDefinition = {
  id: 'component-generator',
  name: 'Component Generator',
  description: 'Generate component and outfit draft pages from an outfit title or URL.',
  icon: '✎',
  group: 'Editing',
  badge: 'EDIT',
  component: ComponentGeneratorView,
};

