import type { QueueItemState, QueueJob, QueueJobContext } from './types';

export class JobQueue {
  private jobs: QueueJob[] = [];
  private listeners = new Set<(items: QueueItemState[]) => void>();
  private items = new Map<string, QueueItemState>();
  private paused = false;
  private running = false;
  private abortController = new AbortController();
  private pauseResolvers: Array<() => void> = [];

  subscribe(listener: (items: QueueItemState[]) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  enqueue(job: QueueJob, total = 1) {
    this.jobs.push(job);
    this.items.set(job.id, { id: job.id, label: job.label, status: 'queued', completed: 0, total });
    this.emit();
    void this.kick();
  }

  pause() {
    this.paused = true;
    const current = this.snapshot().find((item) => item.status === 'running');
    if (current) {
      this.items.set(current.id, { ...current, status: 'paused' });
      this.emit();
    }
  }

  resume() {
    this.paused = false;
    this.pauseResolvers.splice(0).forEach((resolve) => resolve());
    const pausedItems = this.snapshot().filter((item) => item.status === 'paused');
    pausedItems.forEach((item) => this.items.set(item.id, { ...item, status: 'running' }));
    this.emit();
    void this.kick();
  }

  cancelAll() {
    this.abortController.abort();
    this.jobs = [];
    for (const item of this.items.values()) {
      if (item.status === 'queued' || item.status === 'running' || item.status === 'paused') {
        item.status = 'cancelled';
      }
    }
    this.emit();
    this.abortController = new AbortController();
    this.running = false;
    this.paused = false;
  }

  clearFinished() {
    const keep = new Map<string, QueueItemState>();
    for (const [id, item] of this.items) {
      if (item.status === 'queued' || item.status === 'running' || item.status === 'paused') {
        keep.set(id, item);
      }
    }
    this.items = keep;
    this.emit();
  }

  private async kick() {
    if (this.running) return;
    this.running = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      const current = this.items.get(job.id);
      if (!current) continue;
      current.status = this.paused ? 'paused' : 'running';
      this.emit();

      try {
        await this.waitIfPaused();
        const context: QueueJobContext = {
          signal: this.abortController.signal,
          waitIfPaused: () => this.waitIfPaused(),
          reportProgress: (completed, total, message) => {
            const item = this.items.get(job.id);
            if (!item) return;
            this.items.set(job.id, { ...item, completed, total, message, status: this.paused ? 'paused' : 'running' });
            this.emit();
          },
        };
        await job.run(context);
        const item = this.items.get(job.id);
        if (item) {
          item.status = this.abortController.signal.aborted ? 'cancelled' : 'completed';
          item.completed = item.total;
        }
      } catch (error) {
        const item = this.items.get(job.id);
        if (item) {
          item.status = this.abortController.signal.aborted ? 'cancelled' : 'error';
          item.error = error instanceof Error ? error.message : String(error);
        }
      }
      this.emit();
      if (this.abortController.signal.aborted) {
        break;
      }
    }
    this.running = false;
  }

  private waitIfPaused() {
    if (!this.paused) return Promise.resolve();
    return new Promise<void>((resolve) => this.pauseResolvers.push(resolve));
  }

  private snapshot() {
    return Array.from(this.items.values());
  }

  private emit() {
    const items = this.snapshot();
    this.listeners.forEach((listener) => listener(items));
  }
}
