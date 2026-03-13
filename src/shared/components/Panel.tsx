export function Panel({
  title,
  children,
  actions,
  icon = '◆',
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-header">
        <span className="panel-header-icon">{icon}</span>
        <span className="panel-header-title">{title}</span>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
