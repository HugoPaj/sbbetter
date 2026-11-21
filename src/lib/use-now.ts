"use client";

import { useSyncExternalStore } from "react";

/** The current time in seconds, in 30 s steps so live views advance on their own (null on the server). */
export function useNow(): number | null {
  return useSyncExternalStore(
    (tick) => {
      const id = setInterval(tick, 5000);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / 30000) * 30,
    () => null,
  );
}
