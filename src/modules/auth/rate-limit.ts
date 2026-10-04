type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function bucket(key: string, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    const next = { count: 0, resetAt: now + windowMs };
    buckets.set(key, next);
    return next;
  }
  return current;
}

export function isLimited(key: string, limit: number, windowMs: number) {
  return bucket(key, windowMs).count >= limit;
}

export function recordFailure(key: string, windowMs: number) {
  const current = bucket(key, windowMs);
  current.count += 1;
}

export function resetRateLimits() {
  buckets.clear();
}
