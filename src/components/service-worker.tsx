"use client";

import { useEffect } from "react";

/** Registers public/sw.js so the app works installed on the home screen. Not in dev: it would cache HMR builds. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
