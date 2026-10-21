import { AsyncLocalStorage } from "node:async_hooks";

const deadline = new AsyncLocalStorage<AbortSignal>();

export function withinJobDeadline<T>(work: () => Promise<T>) {
  return deadline.run(AbortSignal.timeout(120_000), work);
}

export function jobFetch(input: RequestInfo | URL, init?: RequestInit) {
  const signal = deadline.getStore();
  signal?.throwIfAborted();
  return fetch(input, {
    ...init,
    signal: signal ? AbortSignal.any([signal, init?.signal ?? AbortSignal.timeout(30_000)]) : init?.signal,
  });
}
