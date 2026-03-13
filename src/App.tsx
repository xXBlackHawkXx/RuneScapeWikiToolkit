import { AppProvider, useAppContext } from '@/app/AppProvider';
import { moduleRegistry } from '@/core/modules/registry';
import { Sidebar } from '@/shared/layout/Sidebar';
import { Topbar } from '@/shared/layout/Topbar';
import { Statusbar } from '@/shared/layout/Statusbar';

function AppShell() {
  const { activeModuleId } = useAppContext();
  const activeModule = moduleRegistry.getById(activeModuleId) ?? moduleRegistry.getAll()[0];
  const Active = activeModule.component;

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-area">
        <Topbar module={activeModule} />
        <div className="content-area">
          <Active />
        </div>
        <Statusbar />
      </main>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
