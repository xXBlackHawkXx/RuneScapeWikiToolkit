import { useAppContext } from '@/app/AppProvider';
import { moduleRegistry } from '@/core/modules/registry';

export function Sidebar() {
  const { activeModuleId, setActiveModuleId, dryRun, setDryRun, logEntries } = useAppContext();
  const groups = moduleRegistry.getGroups().filter((group) => group.items.length > 0);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-title">RuneScape Wiki<br />Toolkit</div>
        <div className="logo-sub">runescape.wiki · editor suite</div>
      </div>
      <div className="nav-area">
        {groups.map((group) => (
          <div key={group.name} className="nav-group">
            {group.name !== 'System' ? <div className="nav-group-title">{group.name}</div> : null}
            {group.items.map((module) => (
              <button key={module.id} className={`nav-item ${module.id === activeModuleId ? 'active' : ''}`} onClick={() => setActiveModuleId(module.id)}>
                <span className="nav-icon">{module.icon}</span>
                <span className="nav-label">{module.name}</span>
                {module.id === 'action-log' && logEntries.length > 0 ? <span className="pill-count">{logEntries.length}</span> : null}
                {module.badge ? <span className={`nav-tag nav-tag-${module.badge.toLowerCase()}`}>{module.badge}</span> : null}
              </button>
            ))}
          </div>
        ))}
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
