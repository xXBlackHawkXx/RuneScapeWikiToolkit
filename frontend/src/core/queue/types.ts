export type QueueJobContext = {
  signal: AbortSignal;
  waitIfPaused: () => Promise<void>;
  reportProgress: (completed: number, total: number, message?: string) => void;
};

export type QueueJob<T = unknown> = {
  id: string;
  label: string;
  run: (context: QueueJobContext) => Promise<T>;
};

export type QueueItemState = {
  id: string;
  label: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';
  completed: number;
  total: number;
  message?: string;
  error?: string;
};
