import { appManifest } from "@/lib/app-manifest";

/** The manifest for the light theme: same app, light splash screen (see lib/app-manifest.ts). */
export function GET() {
  return Response.json(appManifest("light"), { headers: { "Content-Type": "application/manifest+json" } });
}
