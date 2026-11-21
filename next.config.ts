import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The service worker must never be cached by the browser, or app updates won't reach installed phones.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  // Tabs folded into others: Trips, Shop and EasyRide into Plan (Upcoming, Other tickets).
  async redirects() {
    return [
      { source: "/trips", destination: "/plan", permanent: false },
      { source: "/shop", destination: "/plan", permanent: false },
      { source: "/easyride", destination: "/plan", permanent: false },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
