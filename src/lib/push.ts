"use client";

import type { Commute } from "./store";

/**
 * Commute alerts in the browser: subscribe this device to push notifications
 * and keep the server's copy of the commute in step (see /api/push).
 */

export type PushSupport =
  | "ok"
  /** iPhone/iPad: web push only works once the app is on the home screen. */
  | "install"
  /** Notifications were blocked for this site. */
  | "blocked"
  /** No service worker (development) or no push in this browser. */
  | "unsupported";

const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (ios() && !standalone()) return "install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return "ok";
}

/** The worker, if one controls the app (production only, see service-worker.tsx). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  return (await (await registration())?.pushManager.getSubscription()) ?? null;
}

const key = (base64url: string) => {
  const raw = atob(base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function json(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/** Ask for permission (call from a tap), subscribe and register the commute. Throws with a message to show. */
export async function enableCommuteAlerts(commute: Commute): Promise<void> {
  const reg = await registration();
  if (!reg) throw new Error("Notifications work in the installed app.");
  const { publicKey } = await json(await fetch("/api/push"));
  if (!publicKey) throw new Error("Notifications aren’t set up on this server.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked. Allow them in your settings.");
  const subscription = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(publicKey) }));
  await json(await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription, commute }) }));
}

export async function disableCommuteAlerts(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe();
}

/** After the commute is edited or deleted: update the alerts, or stop them. Quiet when alerts are off. */
export async function syncCommuteAlerts(commute: Commute | null): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  if (!commute) return disableCommuteAlerts();
  await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub, commute }) }).catch(() => {});
}

/** Check the next commute now and get a notification with the result. Returns what was sent. */
export async function checkCommuteNow(): Promise<string> {
  const sub = await currentSubscription();
  if (!sub) throw new Error("Turn on commute alerts first.");
  const { sent } = await json(await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }));
  return sent;
}
