export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  if (items.length === 0) {
    return [];
  }

  if (limit === 1) {
    const sequential: R[] = [];
    for (let index = 0; index < items.length; index++) {
      sequential.push(await worker(items[index]!, index));
    }
    return sequential;
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index]!, index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    runWorker(),
  );
  await Promise.all(workers);
  return results;
}

export class ConcurrencyTracker {
  current = 0;
  maxObserved = 0;

  enter(): void {
    this.current += 1;
    if (this.current > this.maxObserved) {
      this.maxObserved = this.current;
    }
  }

  leave(): void {
    this.current -= 1;
  }
}

export async function runWithConcurrencyTracked<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R> | R,
  tracker: ConcurrencyTracker,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));

  return runWithConcurrency(items, limit, async (item, index) => {
    tracker.enter();
    try {
      return await worker(item, index);
    } finally {
      tracker.leave();
    }
  });
}
