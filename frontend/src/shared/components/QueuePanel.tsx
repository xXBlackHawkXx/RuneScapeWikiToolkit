import { useAppContext } from '@/app/AppProvider';
import { Panel } from './Panel';
import { Button } from './Form';

export function QueuePanel() {
  const { queue } = useAppContext();

  return (
    <Panel
      title="Job Queue"
      icon="☰"
      actions={
        <div className="button-row">
          <Button onClick={queue.pause}>Pause</Button>
          <Button onClick={queue.resume}>Resume</Button>
          <Button variant="danger" onClick={queue.cancelAll}>Cancel all</Button>
          <Button onClick={queue.clearFinished}>Clear finished</Button>
        </div>
      }
    >
      <div className="queue-list">
        {queue.items.length === 0 ? <div className="muted">No queued jobs.</div> : null}
        {queue.items.map((item) => (
          <div key={item.id} className="queue-item">
            <div className="queue-top">
              <strong>{item.label}</strong>
              <span className={`pill pill-${item.status}`}>{item.status}</span>
            </div>
            <div className="queue-progress-bar">
              <div style={{ width: `${item.total ? (item.completed / item.total) * 100 : 0}%` }} />
            </div>
            <div className="muted small">{item.completed}/{item.total} {item.message ?? ''}</div>
            {item.error ? <div className="error-text small">{item.error}</div> : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}
