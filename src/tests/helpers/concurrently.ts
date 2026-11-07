/**
 * Runs `fn(0) ... fn(n - 1)` so that all of them start together, and resolves when every call has
 * settled. Use it for race tests (the same key twice, the last unit of stock, ten requests at once).
 */
export async function concurrentlySettled<T>(n: number, fn: (index: number) => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError("n must be a positive integer");
  }
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = Array.from({ length: n }, async (_, index) => {
    await gate;
    return fn(index);
  });
  release();
  return Promise.allSettled(running);
}

/** Like `concurrentlySettled`, but returns the values and throws an AggregateError (after all calls settled) if any call failed. */
export async function concurrently<T>(n: number, fn: (index: number) => Promise<T>): Promise<T[]> {
  const results = await concurrentlySettled(n, fn);
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `${failures.length} of ${n} concurrent calls failed`,
    );
  }
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}
