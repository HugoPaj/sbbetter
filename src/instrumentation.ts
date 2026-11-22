/**
 * Runs once when the server starts. A self-hosted server (`next start`) checks
 * commutes for alerts itself, every few minutes. Serverless hosting has no
 * long-running process: there a cron calls /api/push/check instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL) return;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  const { runChecks } = await import("./lib/server/commute-alerts");
  const EVERY = 5 * 60_000;
  // Read when it runs: Next sets PORT once the server is listening.
  const tick = () => runChecks(`http://localhost:${process.env.PORT || 3000}`).catch((e: Error) => console.warn("[commute alerts]", e.message));
  // First run once the server is listening, then on the clock.
  setTimeout(tick, 15_000);
  setInterval(tick, EVERY).unref();
}
