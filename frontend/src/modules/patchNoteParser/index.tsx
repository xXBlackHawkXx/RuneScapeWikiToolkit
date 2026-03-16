import { useMemo, useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { Button, Field, Row } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import type { ModuleDefinition } from '@/core/modules/types';
import { createIndividualPatchSnippet, runPatchNotePipeline, type PatchPipelineResult } from './logic';

type ArtifactKey = keyof PatchPipelineResult['artifacts'];

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

function artifactFilename(key: ArtifactKey) {
  if (key === 'json') return 'changes.json';
  if (key === 'wikitext') return 'changes.wikitext';
  if (key === 'needsReview') return 'needs_review.txt';
  return 'changes.wikitext';
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

function PatchNoteParserView() {
  const { addLog } = useAppContext();
  const [releaseNoteUrl, setReleaseNoteUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PatchPipelineResult | null>(null);
  const [artifactKey, setArtifactKey] = useState<ArtifactKey>('wikitext');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const artifactEntries = useMemo(() => {
    if (!result) {
      return [] as Array<{ key: ArtifactKey; label: string; content: string }>;
    }

    return [
      { key: 'json' as const, label: 'changes.json', content: result.artifacts.json },
      { key: 'wikitext' as const, label: 'changes.wikitext', content: result.artifacts.wikitext },
      { key: 'needsReview' as const, label: 'needs_review.txt', content: result.artifacts.needsReview },
    ];
  }, [result]);

  const selectedArtifact = artifactEntries.find((entry) => entry.key === artifactKey) ?? artifactEntries[0] ?? null;

  const individualEntries = useMemo(() => {
    if (!result) {
      return [] as Array<{
        snippet: string;
        suggestedPage: string;
        suggestedReason: string;
        suggestedConfidence: string;
      }>;
    }

    return result.changes.map((change) => ({
      snippet: createIndividualPatchSnippet(result.metadata, change),
      suggestedPage: change.suggestedPage,
      suggestedReason: change.suggestedPageReason,
      suggestedConfidence: change.suggestedPageConfidence,
    }));
  }, [result]);

  const run = async () => {
    setLoading(true);
    setError(null);
    setCopiedIndex(null);

    try {
      const next = await runPatchNotePipeline({
        releaseNoteUrl,
      });
      setResult(next);
      setArtifactKey('wikitext');
      addLog({
        tool: 'patch-note-parser',
        action: 'Generate patch artifacts',
        dryRun: true,
        summary: `Parsed ${next.metadata.totalChanges} patch-note changes from ${next.metadata.sourceTitle}`,
        status: 'completed',
        executionLog: [`Source: ${next.metadata.releaseNoteUrl}`, `Extracted at: ${next.metadata.extractedAt}`],
      });
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : 'Unknown error while parsing patch notes.';
      setError(message);
      addLog({
        tool: 'patch-note-parser',
        action: 'Generate patch artifacts',
        dryRun: true,
        summary: message,
        status: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const downloadAll = () => {
    if (!result) {
      return;
    }
    for (const entry of artifactEntries) {
      downloadTextFile(entry.label, entry.content);
    }
  };

  const copyEntry = async (index: number, content: string) => {
    await copyText(content);
    setCopiedIndex(index);
  };

  const copyAndOpenEntry = async (index: number, content: string, suggestedPage: string) => {
    await copyText(content);
    setCopiedIndex(index);

    if (!suggestedPage) {
      return;
    }

    const pagePath = encodeURIComponent(suggestedPage.replace(/ /g, '_'));
    const targetUrl = `https://runescape.wiki/w/${pagePath}#Update_history`;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="module-stack">
      <Panel title="Patch Source" icon="⚒">
        <Field label="Release note URL">
          <input value={releaseNoteUrl} onChange={(event) => setReleaseNoteUrl(event.target.value)} />
        </Field>
        <div className="button-row">
          <Button variant="gold" onClick={() => void run()} disabled={loading || !releaseNoteUrl.trim()}>
            {loading ? 'Parsing...' : 'Generate Artifacts'}
          </Button>
          <Button variant="ghost" onClick={downloadAll} disabled={!result}>Download All</Button>
        </div>
        {error ? <div className="error-text">{error}</div> : null}
      </Panel>

      <Panel title="Extraction Summary" icon="▣">
        {!result ? <div className="muted">Run the parser to produce patch-note artifacts.</div> : null}
        {result ? (
          <div className="result-row">
            <div className="result-top">
              <strong>{result.metadata.sourceTitle}</strong>
              <span className="pill pill-completed">{result.metadata.totalChanges} changes</span>
            </div>
            <div className="muted small">Source: {result.metadata.releaseNoteUrl}</div>
            <div className="muted small">Extracted: {result.metadata.extractedAt}</div>
            {result.metadata.sourceTimestamp ? <div className="muted small">Revision: {result.metadata.sourceTimestamp}</div> : null}
          </div>
        ) : null}
      </Panel>

      <Panel title="Individual Patch Notes" icon="✂">
        {individualEntries.length === 0 ? <div className="muted">Generate artifacts to copy individual patch notes.</div> : null}
        {individualEntries.map((entry, index) => (
          <div key={`${index}-${entry.snippet.slice(0, 40)}`} className="result-row">
            <div className="result-top">
              <strong>Patch note {index + 1}</strong>
              <div className="button-row">
                <Button variant="success" onClick={() => void copyEntry(index, entry.snippet)}>
                  {copiedIndex === index ? 'Copied' : 'Copy'}
                </Button>
                <Button
                  variant="gold"
                  onClick={() => void copyAndOpenEntry(index, entry.snippet, entry.suggestedPage)}
                  disabled={!entry.suggestedPage}
                >
                  Copy + Open
                </Button>
              </div>
            </div>
            <div className="muted small">Suggested page: {entry.suggestedPage || 'No existing page found'}</div>
            <div className="muted small">Confidence: {entry.suggestedConfidence} - {entry.suggestedReason}</div>
            <textarea rows={3} readOnly value={entry.snippet} />
          </div>
        ))}
      </Panel>

      <Panel title="Artifacts" icon="⌬">
        <Row>
          <Field label="Artifact">
            <select value={selectedArtifact?.key ?? ''} onChange={(event) => setArtifactKey(event.target.value as ArtifactKey)}>
              {artifactEntries.map((entry) => (
                <option key={entry.key} value={entry.key}>{entry.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Download">
            <Button
              variant="success"
              disabled={!selectedArtifact}
              onClick={() => selectedArtifact ? downloadTextFile(artifactFilename(selectedArtifact.key), selectedArtifact.content) : undefined}
            >
              Download Selected
            </Button>
          </Field>
        </Row>
        <Field label="Content preview">
          <textarea rows={20} readOnly value={selectedArtifact?.content ?? ''} />
        </Field>
      </Panel>
    </div>
  );
}

export const PatchNoteParserModule: ModuleDefinition = {
  id: 'patch-note-parser',
  name: 'Patch Note Parser',
  description: 'Generate structured patch-note artifacts (JSON, wikitext, and review list) from RuneScape update pages.',
  icon: '⚒',
  group: 'Review',
  badge: 'REVIEW',
  component: PatchNoteParserView,
};
