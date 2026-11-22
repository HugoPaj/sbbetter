import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PushSubscription } from "web-push";
import type { Commute } from "../store";

/**
 * Who gets commute alerts: each browser's push subscription with its commute.
 *
 * Kept in Upstash Redis (also what Vercel KV is) when UPSTASH_REDIS_REST_URL /
 * KV_REST_API_URL is set, which serverless hosting needs. Otherwise in a JSON
 * file in .data/, which is enough for a self-hosted `next start`.
 */
export type PushRecord = {
  subscription: PushSubscription;
  commute: Commute;
  /** What was last sent per day and leg ("2026-11-23:out" → signature), so news is sent once. */
  sent: Record<string, string>;
  updated: string;
};

export interface PushStore {
  all(): Promise<PushRecord[]>;
  get(endpoint: string): Promise<PushRecord | null>;
  put(record: PushRecord): Promise<void>;
  remove(endpoint: string): Promise<void>;
}

const HASH = "commute-alerts";

/** Upstash's REST API: one command per request, no client library needed. */
function redisStore(url: string, token: string): PushStore {
  const call = async <T>(...command: string[]): Promise<T> => {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(command), cache: "no-store" });
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`push store: ${body.error ?? res.status}`);
    return body.result as T;
  };
  return {
    async all() {
      const flat = await call<string[]>("HGETALL", HASH);
      const out: PushRecord[] = [];
      for (let i = 1; i < flat.length; i += 2) out.push(JSON.parse(flat[i]));
      return out;
    },
    async get(endpoint) {
      const v = await call<string | null>("HGET", HASH, endpoint);
      return v ? JSON.parse(v) : null;
    },
    async put(r) {
      await call("HSET", HASH, r.subscription.endpoint, JSON.stringify(r));
    },
    async remove(endpoint) {
      await call("HDEL", HASH, endpoint);
    },
  };
}

function fileStore(file: string): PushStore {
  // One writer at a time: each change reads, edits and replaces the whole file.
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<Record<string, PushRecord>> => JSON.parse(await readFile(file, "utf8").catch(() => "{}"));
  const write = async (data: Record<string, PushRecord>) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(data, null, 1));
    await rename(`${file}.tmp`, file);
  };
  const change = (edit: (d: Record<string, PushRecord>) => void) => {
    const next = queue.then(async () => {
      const d = await read();
      edit(d);
      await write(d);
    });
    queue = next.catch(() => {});
    return next;
  };
  return {
    all: async () => Object.values(await read()),
    get: async (endpoint) => (await read())[endpoint] ?? null,
    put: (r) => change((d) => void (d[r.subscription.endpoint] = r)),
    remove: (endpoint) => change((d) => void delete d[endpoint]),
  };
}

let store: PushStore | null = null;

const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

/** Whether subscriptions can be kept here: serverless hosting (Vercel) has no lasting disk, so it needs Redis. */
export const pushStoreAvailable = () => !!(redisUrl() && redisToken()) || !process.env.VERCEL;

export function pushStore(): PushStore {
  if (store) return store;
  const url = redisUrl();
  const token = redisToken();
  store = url && token ? redisStore(url, token) : fileStore(path.join(process.cwd(), ".data", "commute-alerts.json"));
  return store;
}
