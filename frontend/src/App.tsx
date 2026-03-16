import { useState } from 'react';
import { AppProvider, useAppContext } from '@/app/AppProvider';
import { moduleRegistry } from '@/core/modules/registry';
import { Sidebar } from '@/shared/layout/Sidebar';
import { Topbar } from '@/shared/layout/Topbar';
import { Statusbar } from '@/shared/layout/Statusbar';

function AppShell() {
  const { activeModuleId } = useAppContext();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const activeModule = moduleRegistry.getById(activeModuleId) ?? moduleRegistry.getAll()[0];
  const Active = activeModule.component;

  return (
    <div className={`app-shell ${mobileNavOpen ? 'mobile-nav-open' : ''}`}>
      <button
        className="mobile-nav-overlay"
        aria-label="Close navigation menu"
        onClick={() => setMobileNavOpen(false)}
      />
      <Sidebar onNavigate={() => setMobileNavOpen(false)} isMobileOpen={mobileNavOpen} />
      <main className="main-area">
        <Topbar module={activeModule} onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)} />
        <div className="content-area">
          <Active />
        </div>
        <Statusbar />
      </main>
    </div>
  );
}

export function App() {
  const modules = moduleRegistry.getAll().map((module) => ({ id: module.id, name: module.name }));

  return (
    <AppProvider modules={modules}>
      <AppShell />
    </AppProvider>
  );
}
