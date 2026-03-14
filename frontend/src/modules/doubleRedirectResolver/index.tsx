import { useState } from 'react';
import { useAppContext } from '@/app/AppProvider';
import { Button, Field } from '@/shared/components/Form';
import { Panel } from '@/shared/components/Panel';
import { QueuePanel } from '@/shared/components/QueuePanel';
import type { ModuleDefinition } from '@/core/modules/types';

function parseRedirectTarget(source: string) {
  const match = source.match(/(?:^|\n)\s*#redirect\s*:?\s*\[\[([^\]]+)\]\]/im);
  if (!match) {
    return null;
  }
  const value = match[1].split('|')[0]?.trim();
  return value || null;
}

function splitTitleFragment(title: string) {
  const [pageTitle, ...fragmentParts] = title.split('#');
  const fragment = fragmentParts.length > 0 ? fragmentParts.join('#').trim() : '';
  return {
    pageTitle: pageTitle.trim(),
    fragment: fragment || null,
  };
}

function joinTitleFragment(pageTitle: string, fragment: string | null) {
  return fragment ? `${pageTitle}#${fragment}` : pageTitle;
}

function rewriteRedirect(source: string, targetTitle: string) {
  return source.replace(/(^\s*#redirect\s*\[\[)([^\]]+)(\]\].*$)/im, `$1${targetTitle}$3`);
}

function DoubleRedirectResolverView() {
  const { dryRun, wiki, settings, addLog, queue } = useAppContext();
  const [limit, setLimit] = useState('200');
  const [summary, setSummary] = useState('Resolve double redirects');
  const [results, setResults] = useState<string[]>([]);

  async function resolveFinalRedirectTarget(initialTarget: string, maxDepth = 8) {
    let current = initialTarget;
    let redirected = false;
    const seen = new Set<string>();

    for (let depth = 0; depth < maxDepth; depth += 1) {
      const { pageTitle, fragment } = splitTitleFragment(current);
      const normalizedPage = pageTitle.toLowerCase();
      if (!pageTitle || seen.has(normalizedPage)) {
        return { finalTarget: current, redirected, loop: true };
      }
      seen.add(normalizedPage);

      const hop = await wiki.resolveRedirectTarget(pageTitle);
      if (!hop.redirected || hop.targetTitle === pageTitle) {
        return { finalTarget: current, redirected, loop: false };
      }

      redirected = true;
      const carriedFragment = fragment ?? hop.targetFragment ?? null;
      current = joinTitleFragment(hop.targetTitle, carriedFragment);
    }

    return { finalTarget: current, redirected, loop: false };
  }

  const enqueue = async () => {
    const numericLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const titles = await wiki.getDoubleRedirects(numericLimit);
    queue.enqueue(
      {
        id: crypto.randomUUID(),
        label: `Resolve double redirects (${titles.length} pages)`,
        run: async ({ signal, waitIfPaused, reportProgress }) => {
          const nextResults: string[] = [];
          for (let index = 0; index < titles.length; index += 1) {
            if (signal.aborted) {
              throw new Error('Job cancelled');
            }
            await waitIfPaused();

            const redirectTitle = titles[index];
            const { content } = await wiki.getPageSource(redirectTitle);
            let firstHop = parseRedirectTarget(content);
            if (!firstHop) {
              const fallback = await wiki.resolveRedirectTarget(redirectTitle);
              if (fallback.redirected && fallback.targetTitle !== redirectTitle) {
                firstHop = fallback.targetTitle;
              }
            }
            if (!firstHop) {
              nextResults.push(`Skipped ${redirectTitle} (not a redirect).`);
              setResults([...nextResults]);
              reportProgress(index + 1, titles.length, redirectTitle);
              await wiki.delay();
              continue;
            }

            const resolved = await resolveFinalRedirectTarget(firstHop);
            if (resolved.loop) {
              nextResults.push(`Skipped ${redirectTitle} (redirect loop detected).`);
              setResults([...nextResults]);
              reportProgress(index + 1, titles.length, redirectTitle);
              await wiki.delay();
              continue;
            }

            if (!resolved.redirected) {
              nextResults.push(`Skipped ${redirectTitle} (${firstHop} is not currently a redirect).`);
              setResults([...nextResults]);
              reportProgress(index + 1, titles.length, redirectTitle);
              await wiki.delay();
              continue;
            }

            const finalTarget = resolved.finalTarget;
            if (firstHop === finalTarget) {
              nextResults.push(`No change ${redirectTitle} -> ${firstHop}`);
              setResults([...nextResults]);
              reportProgress(index + 1, titles.length, redirectTitle);
              await wiki.delay();
              continue;
            }

            const updatedSource = content ? rewriteRedirect(content, finalTarget) : `#REDIRECT [[${finalTarget}]]`;
            if (!dryRun) {
              await wiki.edit({
                title: redirectTitle,
                text: updatedSource,
                summary: `${settings.summaryPrefix} ${summary}`.trim(),
              });
            }
            nextResults.push(`${dryRun ? 'Simulated' : 'Updated'} ${redirectTitle} -> ${finalTarget}`);
            setResults([...nextResults]);
            reportProgress(index + 1, titles.length, redirectTitle);
            await wiki.delay();
          }

          addLog({
            tool: 'double-redirect-resolver',
            action: dryRun ? 'Simulate' : 'Execute',
            dryRun,
            summary: `Processed ${titles.length} double redirects`,
            status: 'completed',
            executionLog: nextResults,
          });
        },
      },
      titles.length,
    );
  };

  return (
    <div className="module-stack">
      <Panel title="Double Redirect Resolver" icon="↷">
        <Field label="Max redirects to fetch (1-500)">
          <input value={limit} onChange={(event) => setLimit(event.target.value)} />
        </Field>
        <Field label="Edit summary">
          <input value={summary} onChange={(event) => setSummary(event.target.value)} />
        </Field>
        <div className="button-row">
          <Button variant="gold" onClick={() => void enqueue()}>Queue resolver job</Button>
        </div>
      </Panel>
      <QueuePanel />
      <Panel title="Execution Log" icon="☰">
        {results.map((line) => <div key={line} className="result-row">{line}</div>)}
      </Panel>
    </div>
  );
}

export const DoubleRedirectResolverModule: ModuleDefinition = {
  id: 'double-redirect-resolver',
  name: 'Double Redirect Resolver',
  description: 'Find and fix double redirects by repointing pages to their final destination.',
  icon: '↷',
  group: 'Managing',
  badge: 'MANAGE',
  component: DoubleRedirectResolverView,
};



