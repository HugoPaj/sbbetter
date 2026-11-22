import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import path from "node:path";
import type { PushSubscription } from "web-push";
import type { Commute } from "../store";

/**
 * Who gets commute alerts: each browser's push subscription with its commute.
 *
 * Serverless hosting needs a database: Postgres (Neon) when DATABASE_URL /
 * POSTGRES_URL is set, or Upstash Redis (also what Vercel KV is) when
 * UPSTASH_REDIS_REST_URL / KV_REST_API_URL is set. Otherwise a JSON file in
 * .data/, which is enough for a self-hosted `next start`.
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

/** Postgres over Neon's HTTP driver: one row per subscription, the record as JSON. */
function postgresStore(url: string): PushStore {
  const sql = neon(url);
  let ready: Promise<unknown> | null = null;
  const table = () =>
    (ready ??= sql`CREATE TABLE IF NOT EXISTS commute_alerts (endpoint text PRIMARY KEY, record jsonb NOT NULL)`.catch((e) => {
      ready = null;
      throw e;
    }));
  return {
    async all() {
      await table();
      const rows = await sql`SELECT record FROM commute_alerts`;
      return rows.map((r) => r.record as PushRecord);
    },
    async get(endpoint) {
      await table();
      const rows = await sql`SELECT record FROM commute_alerts WHERE endpoint = ${endpoint}`;
      return (rows[0]?.record as PushRecord | undefined) ?? null;
    },
    async put(r) {
      await table();
      const json = JSON.stringify(r);
      await sql`INSERT INTO commute_alerts (endpoint, record) VALUES (${r.subscription.endpoint}, ${json}::jsonb)
        ON CONFLICT (endpoint) DO UPDATE SET record = EXCLUDED.record`;
    },
    async remove(endpoint) {
      await table();
      await sql`DELETE FROM commute_alerts WHERE endpoint = ${endpoint}`;
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

const postgresUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL;
const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

/** Whether subscriptions can be kept here: serverless hosting (Vercel) has no lasting disk, so it needs a database. */
export const pushStoreAvailable = () => !!postgresUrl() || !!(redisUrl() && redisToken()) || !process.env.VERCEL;

export function pushStore(): PushStore {
  if (store) return store;
  const pg = postgresUrl();
  const url = redisUrl();
  const token = redisToken();
  store = pg
    ? postgresStore(pg)
    : url && token
      ? redisStore(url, token)
      : fileStore(path.join(process.cwd(), ".data", "commute-alerts.json"));
  return store;
}
