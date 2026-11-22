"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/**
 * Whether this tab has moved between pages of the app since it loaded. Only consulted where the
 * Navigation API (which knows the history exactly) is missing.
 */
let navigated = false;

/** Where each page (by URL) was scrolled to, so going back returns to the same spot. */
const scrollPositions = new Map<string, number>();

/** The app's scroll container on phones; null when the window scrolls (desktop), which the browser restores itself. */
function scroller(): HTMLElement | null {
  const el = document.getElementById("app-scroll");
  return el && getComputedStyle(el).overflowY !== "visible" ? el : null;
}

/**
 * Bring a page we came back to back to where it was scrolled. Its content may still be streaming
 * in (or the router may scroll it on commit), so keep at it for a moment, until the user takes over.
 */
function restoreScroll() {
  const el = scroller();
  const target = scrollPositions.get(location.href);
  if (!el || target === undefined) return;
  let frames = 0;
  let stop = false;
  const cancel = () => (stop = true);
  const opts = { once: true, passive: true } as const;
  el.addEventListener("touchstart", cancel, opts);
  el.addEventListener("wheel", cancel, opts);
  const step = () => {
    if (stop) return;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
    // A few frames past reaching it, in case a late commit scrolls it away again; give up after ~1.5 s.
    const settled = Math.abs(el.scrollTop - target) <= 1 && frames > 12;
    if (!settled && ++frames < 90) requestAnimationFrame(step);
    else {
      el.removeEventListener("touchstart", cancel);
      el.removeEventListener("wheel", cancel);
    }
  };
  requestAnimationFrame(step);
}

/** Mounted once (in the bottom nav): notes in-app page changes and keeps scroll positions for back/forward. */
export function useTrackNavigation() {
  const pathname = usePathname();
  const first = useRef(pathname);
  useEffect(() => {
    if (pathname !== first.current) navigated = true;
  }, [pathname]);

  useEffect(() => {
    const el = document.getElementById("app-scroll");
    if (!el) return;
    // Saved once scrolling pauses, and again on the tap that may leave the page, under the URL
    // showing at that moment (a page swap's own scroll jumps only ever land on the new page).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => scrollPositions.set(location.href, el.scrollTop);
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 120);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerdown", save, { capture: true, passive: true });
    window.addEventListener("popstate", restoreScroll);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", save, { capture: true });
      window.removeEventListener("popstate", restoreScroll);
    };
  }, []);
}

type NavigationLike = { canGoBack?: boolean };

/** True when the previous history entry is a page of this app, so the browser's back lands inside it. */
function canGoBackInApp(): boolean {
  const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
  // Only lists same-origin entries: false for a deep link (push notification, shared URL, fresh PWA start).
  if (typeof nav?.canGoBack === "boolean") return nav.canGoBack;
  return navigated && window.history.length > 1;
}

/**
 * The header's back button: back to the page the user actually came from (scroll position and
 * all), like the system back gesture. Opened straight onto this page, there is nothing to go
 * back to: go up to `fallback` instead, replacing this entry so the stack doesn't grow.
 */
export function useBack(fallback: string) {
  const router = useRouter();
  return useCallback(() => {
    if (canGoBackInApp()) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}
