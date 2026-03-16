import { useAppContext } from '@/app/AppProvider';
import type { ModuleDefinition } from '@/core/modules/types';

type TopbarProps = {
  module: ModuleDefinition;
  onToggleMobileNav?: () => void;
};

export function Topbar({ module, onToggleMobileNav }: TopbarProps) {
  const { dryRun, settings } = useAppContext();
  const badgeClass = module.badge ? `topbar-pill topbar-pill-${module.badge.toLowerCase()}` : '';

  return (
    <header className="topbar">
      <button className="mobile-menu-btn" onClick={onToggleMobileNav} aria-label="Open navigation menu" type="button">
        ☰
      </button>
      <div className="topbar-title-wrap">
        <div className="topbar-title">{module.icon} {module.name}</div>
        <div className="topbar-subtitle">{module.description}</div>
      </div>
      {dryRun ? <span className="topbar-pill topbar-pill-dry">Dry Run</span> : null}
      {module.badge ? <span className={badgeClass}>{module.badge}</span> : null}
      <div className="wiki-conn">
        <div className={`conn-dot ${settings.username ? 'dot-live' : ''}`} style={{ background: settings.username ? 'var(--green)' : 'var(--text-muted)' }} />
        runescape.wiki
      </div>
    </header>
  );
}
