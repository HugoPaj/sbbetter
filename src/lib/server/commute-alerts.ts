import { WebPushError, sendNotification, setVapidDetails } from "web-push";
import { setAppOrigin } from "../app-url";
import { checkCommute, dueLeg, type CommuteAlert } from "../commute-alert";
import { pushStore, pushStoreAvailable, type PushRecord } from "./push-store";

/**
 * Sends commute alerts. `runChecks` looks at every subscribed commute that is
 * due (see dueLeg) and pushes what changed since the last notification. It is
 * called every few minutes, by the in-process timer (src/instrumentation.ts,
 * self-hosted) or a cron hitting /api/push/check (serverless).
 */

export const pushEnabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) && pushStoreAvailable();

/**
 * This app's own URL, for a request handler. Self-hosted, the request's Host header is the
 * caller's to choose, and the checks would then ask that host for timetable data: use the
 * local port instead (as src/instrumentation.ts does). Vercel only routes hosts that are ours.
 */
export const selfOrigin = (requestOrigin: string) => (process.env.VERCEL ? requestOrigin : `http://localhost:${process.env.PORT || 3000}`);

let configured = false;
function configure() {
  if (configured) return;
  setVapidDetails(process.env.VAPID_SUBJECT || "mailto:commute-alerts@example.invalid", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

/** What the service worker shows (public/sw.js, "push"). */
export type PushPayload = { title: string; body: string; url: string; tag: string };

/** Sends one notification; false when the subscription is gone (unsubscribed, app removed), which is then forgotten. */
async function send(record: PushRecord, alert: CommuteAlert): Promise<boolean> {
  return sendPayload(record, { title: alert.title, body: alert.body, url: alert.url, tag: `commute-${alert.kind}` }, alert.kind === "ok" ? "normal" : "high");
}

async function sendPayload(record: PushRecord, payload: PushPayload, urgency: "normal" | "high"): Promise<boolean> {
  configure();
  try {
    await sendNotification(record.subscription, JSON.stringify(payload), { TTL: 30 * 60, urgency });
    return true;
  } catch (e) {
    if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) {
      await pushStore().remove(record.subscription.endpoint);
      return false;
    }
    throw e;
  }
}

/** Check every due commute and send what is new. `origin` is this app's own URL (its timetable API). */
export async function runChecks(origin: string, now = new Date()): Promise<{ checked: number; sent: number; failed: number }> {
  if (!pushEnabled()) return { checked: 0, sent: 0, failed: 0 };
  setAppOrigin(origin);
  const records = await pushStore().all();
  let checked = 0;
  let sent = 0;
  let failed = 0;
  // A few at a time: each check is a couple of timetable requests, and OJP allows 50 a minute.
  const queue = [...records];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const leg = dueLeg(r.commute, now);
      if (!leg) continue;
      checked++;
      try {
        const alert = await checkCommute(r.commute, leg, now);
        const key = `${leg.date}:${leg.back ? "back" : "out"}`;
        // "Runs on time" is only for the Check now button; and every piece of news only once.
        if (!alert || alert.kind === "ok" || r.sent[key] === alert.signature) continue;
        if (await send(r, alert)) {
          sent++;
          // Only today's keys are worth keeping.
          const sentToday = Object.fromEntries(Object.entries(r.sent).filter(([k]) => k.startsWith(leg.date)));
          await pushStore().put({ ...r, sent: { ...sentToday, [key]: alert.signature }, updated: now.toISOString() });
        }
      } catch (e) {
        failed++;
        console.warn("[commute alerts]", (e as Error).message);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { checked, sent, failed };
}

/** The "Check now" button: the next commute leg for one subscription, sent whatever it says (on time included). */
export async function checkNow(origin: string, endpoint: string): Promise<CommuteAlert | null> {
  setAppOrigin(origin);
  const r = await pushStore().get(endpoint);
  if (!r) return null;
  const leg = dueLeg(r.commute, new Date(), true)!;
  const alert = await checkCommute(r.commute, leg);
  if (alert && !(await send(r, alert))) throw new GoneError();
  return alert;
}

/** A replay update (demo) to a subscribed device, through its push service. False: not subscribed here. */
export async function pushTo(endpoint: string, payload: PushPayload): Promise<boolean> {
  const r = await pushStore().get(endpoint);
  if (!r) return false;
  if (!(await sendPayload(r, payload, "high"))) throw new GoneError();
  return true;
}

/** The device's subscription expired or was removed (it has been forgotten). */
export class GoneError extends Error {
  constructor() {
    super("This device is no longer subscribed. Turn commute alerts off and on again.");
  }
}
