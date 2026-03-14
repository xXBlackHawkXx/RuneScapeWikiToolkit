import { useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { Button, Field, Row } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import type { CompareResponse } from '@/core/mediawiki/types';
import type { ModuleDefinition } from '@/core/modules/types';

type DiffLineType = 'context' | 'old' | 'new';

type DiffLine = {
  type: DiffLineType;
  text: string;
  html?: string;
};

function normalizeDiffText(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
}

function extractLines(cell: Element) {
  const lineNodes = Array.from(cell.querySelectorAll('div'));
  const nodes = lineNodes.length > 0 ? lineNodes : [cell];
  return nodes.map((node) => normalizeDiffText(node.textContent ?? ''));
}

function extractRichLines(cell: Element) {
  const lineNodes = Array.from(cell.querySelectorAll('div'));
  const nodes = lineNodes.length > 0 ? lineNodes : [cell];
  return nodes.map((node) => {
    const html = node.innerHTML;
    return {
      text: normalizeDiffText(node.textContent ?? ''),
      html,
    };
  });
}

function parseDiffLines(html: string) {
  const wrapped = `<table><tbody>${html}</tbody></table>`;
  const parsed = new DOMParser().parseFromString(wrapped, 'text/html');
  const rows = Array.from(parsed.querySelectorAll('tr'));
  const lines: DiffLine[] = [];

  rows.forEach((row) => {
    const deletedCells = Array.from(row.querySelectorAll('td.diff-deletedline'));
    const addedCells = Array.from(row.querySelectorAll('td.diff-addedline'));
    const contextCells = Array.from(row.querySelectorAll('td.diff-context, td.diff-empty'));

    deletedCells.forEach((cell) => {
      extractRichLines(cell).forEach((line) => lines.push({ type: 'old', text: line.text, html: line.html }));
    });
    addedCells.forEach((cell) => {
      extractRichLines(cell).forEach((line) => lines.push({ type: 'new', text: line.text, html: line.html }));
    });

    if (deletedCells.length === 0 && addedCells.length === 0) {
      contextCells.forEach((cell) => {
        extractRichLines(cell).forEach((line) => lines.push({ type: 'context', text: line.text, html: line.html }));
      });
    }
  });

  if (lines.length > 0) {
    return lines;
  }

  const fallbackText = normalizeDiffText(html).split('\n');
  return fallbackText.map((rawLine) => {
    const text = rawLine.trimEnd();
    if (/^[+\uFF0B]/.test(text)) {
      return { type: 'new' as const, text: text.replace(/^[+\uFF0B]\s?/, '') };
    }
    if (/^[-\u2212]/.test(text)) {
      return { type: 'old' as const, text: text.replace(/^[-\u2212]\s?/, '') };
    }
    return { type: 'context' as const, text };
  });
}

function buildHistoryUrl(apiUrl: string, pageTitle: string) {
  const parsed = new URL(apiUrl);
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/api\.php\/?$/, '/index.php');
  parsed.searchParams.set('title', pageTitle.replace(/ /g, '_'));
  parsed.searchParams.set('action', 'history');
  return parsed.toString();
}

function PageDiffView() {
  const { wiki, settings, addLog } = useAppContext();
  const [title, setTitle] = useState('Zaros');
  const [revA, setRevA] = useState('prev');
  const [revB, setRevB] = useState('cur');
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [lines, setLines] = useState<DiffLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(false);

  const lineCounts = lines.reduce(
    (acc, line) => {
      if (line.type === 'new') acc.added += 1;
      if (line.type === 'old') acc.removed += 1;
      return acc;
    },
    { added: 0, removed: 0 },
  );

  const load = async () => {
    setError('');
    setIsLoading(true);
    try {
      const nextCompare = await wiki.compare(title, revA, revB);
      const nextLines = parseDiffLines(nextCompare['*']);
      setCompare(nextCompare);
      setLines(nextLines);
      setShown(true);
      addLog({
        tool: 'page-diff',
        action: 'Load Page Diff',
        dryRun: false,
        summary: `Loaded diff for "${title}" (${revA} -> ${revB})`,
        status: 'completed',
        executionLog: [
          `Page: ${title}`,
          `Requested revisions: ${revA} -> ${revB}`,
          `Compared revisions: ${nextCompare.fromrevid} -> ${nextCompare.torevid}`,
          `Changes: +${nextLines.filter((line) => line.type === 'new').length} / -${nextLines.filter((line) => line.type === 'old').length}`,
        ],
      });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load diff.';
      setError(message);
      addLog({
        tool: 'page-diff',
        action: 'Load Page Diff',
        dryRun: false,
        summary: `Failed to load diff for "${title}"`,
        status: 'error',
        details: message,
        executionLog: [`Page: ${title}`, `Requested revisions: ${revA} -> ${revB}`],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const openHistory = () => {
    window.open(buildHistoryUrl(settings.apiUrl, title), '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="module-stack">
      <Panel title="Diff Viewer" icon="⊕">
        <Row>
          <Field label="Page Title"><input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="Revision A"><input value={revA} onChange={(event) => setRevA(event.target.value)} /></Field>
          <Field label="Revision B"><input value={revB} onChange={(event) => setRevB(event.target.value)} /></Field>
        </Row>
        <div className="button-row">
          <Button variant="gold" onClick={() => void load()} disabled={isLoading}>{isLoading ? 'Loading...' : '⊕  Load Diff'}</Button>
          <Button variant="ghost" onClick={openHistory}>⟲  Revision History</Button>
        </div>
      </Panel>
      {error ? <div className="error-text">{error}</div> : null}
      {shown ? (
        <Panel title={`Revision Diff - ${title}`} icon="⊕">
          {compare ? (
            <div className="diff-output-meta">
              <span className="diff-output-rev">rev {compare.fromrevid}</span>
              <span className="diff-output-arrow">{' -> '}</span>
              <span className="diff-output-rev">rev {compare.torevid}</span>
              <span className="diff-output-summary"> +{lineCounts.added} / -{lineCounts.removed}</span>
            </div>
          ) : null}
          {lines.length === 0 ? <div className="muted">No line-level changes were returned for this comparison.</div> : null}
          {lines.map((line, index) => {
            if (line.type === 'old') {
              return (
                <div key={`${line.type}-${index}`} className="diff-old">
                  <span className="diff-prefix">- </span>
                  {line.html ? <span dangerouslySetInnerHTML={{ __html: line.html }} /> : <span>{line.text || ' '}</span>}
                </div>
              );
            }
            if (line.type === 'new') {
              return (
                <div key={`${line.type}-${index}`} className="diff-new">
                  <span className="diff-prefix">+ </span>
                  {line.html ? <span dangerouslySetInnerHTML={{ __html: line.html }} /> : <span>{line.text || ' '}</span>}
                </div>
              );
            }
            return (
              <div key={`${line.type}-${index}`} className="diff-ctx">
                <span className="diff-prefix">  </span>
                {line.html ? <span dangerouslySetInnerHTML={{ __html: line.html }} /> : <span>{line.text || ' '}</span>}
              </div>
            );
          })}
        </Panel>
      ) : null}
    </div>
  );
}

export const PageDiffModule: ModuleDefinition = {
  id: 'page-diff',
  name: 'Page Diff',
  description: 'Compare two revisions of a page and inspect the rendered diff output.',
  icon: '⊕',
  group: 'Review',
  badge: 'REVIEW',
  component: PageDiffView,
};
