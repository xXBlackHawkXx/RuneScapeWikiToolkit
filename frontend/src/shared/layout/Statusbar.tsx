import { useAppContext } from '@/app/AppProvider';

export function Statusbar() {
  const { dryRun, settings, logEntries } = useAppContext();
  return (
    <footer className="statusbar">
      <div className="status-item">
        <div className="status-dot" style={{ background: dryRun ? 'var(--amber)' : 'var(--green)' }} />
        {dryRun ? 'Dry Run Active' : 'Live Mode'}
      </div>
      <div className="status-item">
        <div className="status-dot" style={{ background: settings.username ? 'var(--green)' : 'var(--red-dim)' }} />
        {settings.username || 'Not Authenticated'}
      </div>
      <div className="status-item">☰ {logEntries.length} Log Entries</div>
      <div className="status-spacer" />
      <div className="status-item">rs3-wiki-toolkit v0.2.0</div>
    </footer>
  );
}
