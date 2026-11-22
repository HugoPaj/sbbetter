/**
 * The scheduled check: who is due, what is sent, and that news is sent once.
 * The timetable and the push service are stand-ins; the store is a real file.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { CommuteAlert } from "../commute-alert";

const sent: { endpoint: string; payload: { title: string } }[] = [];
let gone = new Set<string>();
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(readonly statusCode: number) {
      super(`push ${statusCode}`);
    }
  }
  return {
    WebPushError,
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, body: string) => {
      if (gone.has(sub.endpoint)) throw new WebPushError(410);
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
    },
  };
});

let news: CommuteAlert;
vi.mock("../commute-alert", async (actual) => ({ ...(await actual<typeof import("../commute-alert")>()), checkCommute: vi.fn(async () => news) }));

const alert = (kind: CommuteAlert["kind"], signature: string): CommuteAlert => ({ kind, signature, title: `${kind} ${signature}`, body: "", url: "/x" });
const commute = { from: "1", fromName: "A", to: "2", toName: "B", outTime: "07:30", backTime: "17:30" };
const sub = (id: string) => ({ endpoint: `https://push.example/${id}`, keys: { p256dh: "k", auth: "a" } });
const monday = (hhmm: string) => new Date(`2026-11-23T${hhmm}:00+01:00`);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("POSTGRES_URL", "");
  vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(path.join(tmpdir(), "alerts-")));
  sent.length = 0;
  gone = new Set();
});

async function setup(...ids: string[]) {
  const { pushStore } = await import("./push-store");
  for (const id of ids) await pushStore().put({ subscription: sub(id), commute, sent: {}, updated: "" });
  const { runChecks } = await import("./commute-alerts");
  return { runChecks, store: pushStore() };
}

test("nobody is due outside the hour before a commute", async () => {
  const { runChecks } = await setup("a");
  news = alert("late", "late:1");
  expect(await runChecks("http://app", monday("10:00"))).toEqual({ checked: 0, sent: 0, failed: 0 });
  expect(sent).toEqual([]);
});

test("news is sent once, and again when it changes", async () => {
  const { runChecks } = await setup("a", "b");
  news = alert("late", "late:1");
  expect(await runChecks("http://app", monday("07:00"))).toEqual({ checked: 2, sent: 2, failed: 0 });
  expect(await runChecks("http://app", monday("07:05"))).toEqual({ checked: 2, sent: 0, failed: 0 });
  news = alert("closed", "closed:Neuchâtel");
  expect(await runChecks("http://app", monday("07:10"))).toMatchObject({ sent: 2 });
  expect(sent.map((s) => s.payload.title)).toEqual(["late late:1", "late late:1", "closed closed:Neuchâtel", "closed closed:Neuchâtel"]);
});

test("'on time' is never pushed by the schedule", async () => {
  const { runChecks } = await setup("a");
  news = alert("ok", "ok");
  expect(await runChecks("http://app", monday("07:00"))).toMatchObject({ checked: 1, sent: 0 });
});

test("a device that is gone is forgotten; the others still get theirs", async () => {
  const { runChecks, store } = await setup("a", "b");
  gone.add(sub("a").endpoint);
  news = alert("late", "late:1");
  expect(await runChecks("http://app", monday("07:00"))).toMatchObject({ sent: 1 });
  expect((await store.all()).map((r) => r.subscription.endpoint)).toEqual([sub("b").endpoint]);
});

test("nothing happens without push keys", async () => {
  vi.stubEnv("VAPID_PRIVATE_KEY", "");
  const { runChecks } = await setup("a");
  news = alert("late", "late:1");
  expect(await runChecks("http://app", monday("07:00"))).toEqual({ checked: 0, sent: 0, failed: 0 });
});
