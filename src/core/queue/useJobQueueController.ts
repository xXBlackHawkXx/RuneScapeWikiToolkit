import { useEffect, useMemo, useState } from 'react';
import { JobQueue } from './JobQueue';
import type { QueueItemState, QueueJob } from './types';

export function useJobQueueController() {
  const queue = useMemo(() => new JobQueue(), []);
  const [items, setItems] = useState<QueueItemState[]>([]);

  useEffect(() => {
    const unsubscribe = queue.subscribe(setItems);
    return () => {
      unsubscribe();
    };
  }, [queue]);

  return {
    items,
    enqueue: (job: QueueJob, total?: number) => queue.enqueue(job, total),
    pause: () => queue.pause(),
    resume: () => queue.resume(),
    cancelAll: () => queue.cancelAll(),
    clearFinished: () => queue.clearFinished(),
  };
}
