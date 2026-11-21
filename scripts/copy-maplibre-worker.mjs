// Copies MapLibre's web worker into /public so it can be served at a stable URL
// (bundlers rewrite import.meta.url, which breaks MapLibre's default lookup).
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");
console.log("copied maplibre-gl-worker.mjs → public/");
