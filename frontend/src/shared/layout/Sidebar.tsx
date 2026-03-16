import { useAppContext } from '@/app/AppProvider';
import { moduleRegistry } from '@/core/modules/registry';

type SidebarProps = {
  onNavigate?: () => void;
  isMobileOpen?: boolean;
};

export function Sidebar({ onNavigate, isMobileOpen = false }: SidebarProps) {
  const { activeModuleId, setActiveModuleId, dryRun, setDryRun, logEntries } = useAppContext();
  const groups = moduleRegistry
    .getGroups()
    .filter((group) => group.items.length > 0 && group.name !== 'System');
  const footerModules = moduleRegistry
    .getAll()
    .filter((module) => module.id === 'action-log' || module.id === 'settings');

  const renderModuleButton = (module: (typeof footerModules)[number]) => (
    <button
      key={module.id}
      className={`nav-item ${module.id === activeModuleId ? 'active' : ''}`}
      onClick={() => {
        setActiveModuleId(module.id);
        onNavigate?.();
      }}
    >
      <span className="nav-icon">{module.icon}</span>
      <span className="nav-label">{module.name}</span>
      {module.id === 'action-log' && logEntries.length > 0 ? <span className="pill-count">{logEntries.length}</span> : null}
      {module.badge ? <span className={`nav-tag nav-tag-${module.badge.toLowerCase()}`}>{module.badge}</span> : null}
    </button>
  );

  return (
    <aside className={`sidebar ${isMobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-header">
        <div className="logo-title">RuneScape Wiki<br />Toolkit</div>
        <div className="logo-sub">runescape.wiki · editor suite</div>
      </div>
      <div className="nav-area">
        {groups.map((group) => (
          <div key={group.name} className="nav-group">
            <div className="nav-group-title">{group.name}</div>
            {group.items.map((module) => renderModuleButton(module))}
          </div>
        ))}
      </div>
      <div className="sidebar-footer-nav">
        {footerModules.map((module) => renderModuleButton(module))}
      </div>
      <button className={`dry-toggle ${dryRun ? 'active' : ''}`} onClick={() => setDryRun((prev) => !prev)}>
        <div>
          <div className="dry-label">Dry Run Mode</div>
          <div className="dry-hint">{dryRun ? 'No changes written to wiki' : 'Live - edits will be saved'}</div>
        </div>
        <div className={`toggle-track ${dryRun ? 'on' : ''}`}><div className="toggle-knob" /></div>
      </button>
    </aside>
  );
}
