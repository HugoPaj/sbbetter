import type { MetadataRoute } from "next";

/** Page background per theme (globals.css --color-page): the install splash screen uses it. */
export const SPLASH = { dark: "#000000", light: "#f2f2f2" } as const;

/**
 * The web app manifest. There are two (only the splash colour differs) because a manifest can't
 * follow the theme: the layout's theme script points <link rel="manifest"> at the matching one.
 */
export function appManifest(theme: keyof typeof SPLASH): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SBBetter (prototype)",
    short_name: "SBBetter",
    description: "Hackathon prototype of the SBB Mobile app",
    start_url: "/plan",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: SPLASH[theme],
    theme_color: "#eb0000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/** Point the page's manifest link at the one for this theme (also done by the inline theme script). */
export function manifestHref(theme: keyof typeof SPLASH): string {
  return theme === "light" ? "/manifest-light.webmanifest" : "/manifest.webmanifest";
}
