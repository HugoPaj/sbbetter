import { useSyncExternalStore } from "react";
import { manifestHref } from "./app-manifest";

/**
 * Light / dark appearance. The choice lives in localStorage; "system" (nothing
 * stored) follows the device. The resolved theme is written to
 * `<html data-theme>`, which the colour tokens in globals.css key off. An inline
 * script in the root layout sets it before the first paint.
 */
export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

/** Also read by the inline script in the root layout. */
export const THEME_KEY = "sbb-theme";

export const THEME_OPTIONS: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: "system", label: "System", hint: "Follows your device setting" },
  { value: "light", label: "Light", hint: "Always light" },
  { value: "dark", label: "Dark", hint: "Always dark" },
];

const listeners = new Set<() => void>();
const prefersLight = () => matchMedia("(prefers-color-scheme: light)");

function choice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function resolved(): Theme {
  const c = choice();
  return c === "system" ? (prefersLight().matches ? "light" : "dark") : c;
}

function apply() {
  const theme = resolved();
  document.documentElement.dataset.theme = theme;
  // The install splash screen takes its colour from the manifest.
  document.querySelector('link[rel="manifest"]')?.setAttribute("href", manifestHref(theme));
  listeners.forEach((l) => l());
}

export function setTheme(next: ThemeChoice) {
  try {
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private mode: the choice just doesn't persist.
  }
  apply();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const media = prefersLight();
  media.addEventListener("change", apply);
  window.addEventListener("storage", apply);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", apply);
    window.removeEventListener("storage", apply);
  };
}

/** What the user picked ("system" until they choose). */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, choice, () => "system");
}

/** The theme actually shown. Dark on the server, corrected on the client. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, resolved, () => "dark");
}
