import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cacheKey, shared } from "./upstream-cache";

let n = 0;
const key = () => `test-${n++}`;
const live = () => new AbortController().signal;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("the same parameters in any order are the same request", () => {
  const a = cacheKey("ojp", "connections", new URLSearchParams("from=A&to=B&limit=4"));
  expect(cacheKey("ojp", "connections", new URLSearchParams("limit=4&to=B&from=A"))).toBe(a);
  expect(cacheKey("opendata", "connections", new URLSearchParams("from=A&to=B&limit=4"))).not.toBe(a);
  expect(cacheKey("ojp", "connections", new URLSearchParams("from=A&to=C&limit=4"))).not.toBe(a);
});

test("identical requests in flight share one upstream call", async () => {
  const k = key();
  const run = vi.fn(async () => "answer");
  const [a, b] = await Promise.all([shared(k, 1000, run, live()), shared(k, 1000, run, live())]);
  expect([a, b]).toEqual(["answer", "answer"]);
  expect(run).toHaveBeenCalledTimes(1);
});

test("an answer is reused until it is older than its time to live", async () => {
  const k = key();
  const run = vi.fn(async () => Date.now());
  const first = await shared(k, 1000, run, live());
  vi.advanceTimersByTime(900);
  expect(await shared(k, 1000, run, live())).toBe(first);
  vi.advanceTimersByTime(200);
  expect(await shared(k, 1000, run, live())).not.toBe(first);
  expect(run).toHaveBeenCalledTimes(2);
});

test("failures are not kept", async () => {
  const k = key();
  const run = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("up");
  await expect(shared(k, 1000, run, live())).rejects.toThrow("down");
  expect(await shared(k, 1000, run, live())).toBe("up");
});

test("one caller leaving doesn't cancel the call for the others", async () => {
  const k = key();
  let finish!: (v: string) => void;
  let upstream!: AbortSignal;
  const run = (signal: AbortSignal) => {
    upstream = signal;
    return new Promise<string>((resolve) => (finish = resolve));
  };
  const leaving = new AbortController();
  const a = shared(k, 1000, run, leaving.signal);
  const b = shared(k, 1000, run, live());
  leaving.abort();
  await expect(a).rejects.toBeDefined();
  expect(upstream.aborted).toBe(false);
  finish("answer");
  expect(await b).toBe("answer");
});
