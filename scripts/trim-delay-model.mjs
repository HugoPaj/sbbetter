/**
 * Cut public/delay-model.json down to what the app evaluates. The training
 * export (train.py, not in this repo) carries five models: the chance of 3, 6
 * and 10 minutes of delay, the median and the 80th percentile. The app shows
 * only the 80th percentile (src/lib/connection-estimate.ts), so the other four
 * are 3.5 MB every phone would download and parse for nothing.
 *
 * Run after every new export:  node scripts/trim-delay-model.mjs
 * Safe to run twice. To show another figure, add its model to KEEP and export again.
 */
import { readFileSync, writeFileSync } from "node:fs";

const KEEP = ["q80"];
const file = new URL("../public/delay-model.json", import.meta.url);
const before = readFileSync(file, "utf8");
const model = JSON.parse(before);
const missing = KEEP.filter((k) => !model.models[k]);
if (missing.length) throw new Error(`delay model has no ${missing.join(", ")}: export it again from train.py`);
model.models = Object.fromEntries(KEEP.map((k) => [k, model.models[k]]));
const after = JSON.stringify(model);
writeFileSync(file, after);
console.log(`delay-model.json: ${(before.length / 1e6).toFixed(2)} MB -> ${(after.length / 1e6).toFixed(2)} MB (models: ${KEEP.join(", ")})`);
