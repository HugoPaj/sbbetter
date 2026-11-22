/**
 * Short-lived cache in front of the timetable APIs. OJP allows 50 requests a
 * minute per key, and a demo with a few phones asks the same thing many times:
 * the same departure board, the same search right after a reload. Identical
 * requests share one upstream call while it runs, and its answer is reused for
 * a few seconds after.
 *
 * The upstream call is not tied to any one browser request: when the person
 * who started it navigates away, the others waiting for it still get the
 * answer. It has its own timeout instead. Failures are not cached.
 */

type Entry = { promise: Promise<unknown>; expires: number };

const entries = new Map<string, Entry>();
const MAX_ENTRIES = 500;
const UPSTREAM_TIMEOUT = 25_000;

/** How long an answer is reused, by endpoint. Real-time data stays fresh; stop names barely change. */
export const TTL: Record<string, number> = {
  connections: 30_000,
  stationboard: 20_000,
  locations: 5 * 60_000,
};

/** A stable key for a request: the same parameters in any order give the same key. */
export function cacheKey(source: string, endpoint: string, sp: URLSearchParams): string {
  const params = [...sp].sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  return `${source}:${endpoint}?${new URLSearchParams(params)}`;
}

export function shared<T>(key: string, ttl: number, run: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  const now = Date.now();
  let entry = entries.get(key);
  if (!entry || entry.expires < now) {
    if (entries.size >= MAX_ENTRIES) {
      // Drop expired answers, then the oldest (a Map iterates in insertion order).
      for (const [k, v] of entries) if (v.expires < now || entries.size >= MAX_ENTRIES) entries.delete(k);
    }
    const promise = run(AbortSignal.timeout(UPSTREAM_TIMEOUT));
    // Counts from the start of the call, so the answer stays fresh until it arrives and `ttl` after at most.
    const created: Entry = { promise, expires: Infinity };
    promise.then(
      () => {
        created.expires = Date.now() + ttl;
      },
      () => {
        if (entries.get(key) === created) entries.delete(key);
      },
    );
    entries.delete(key);
    entries.set(key, created);
    entry = created;
  }
  return untilAborted(entry.promise as Promise<T>, signal);
}

/** `promise`, or a rejection as soon as this caller's request is aborted. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", abort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", abort);
        reject(e);
      },
    );
  });
}
