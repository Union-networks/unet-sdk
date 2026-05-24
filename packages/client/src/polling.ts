import { UnetTimeoutError } from './errors.js';
import type { PollOptions } from './types.js';

export async function pollUntil<T>(load: () => Promise<T>, done: (value: T) => boolean, options: PollOptions = {}): Promise<T> {
  const intervalMs = options.intervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 120000;
  const started = Date.now();
  for (;;) {
    if (options.signal?.aborted) throw new UnetTimeoutError('U-net polling aborted');
    const value = await load();
    if (done(value)) return value;
    if (Date.now() - started >= timeoutMs) throw new UnetTimeoutError();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
