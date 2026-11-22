import type { MetadataRoute } from "next";
import { appManifest } from "@/lib/app-manifest";

/** Dark theme manifest; the light one is /manifest-light.webmanifest (see lib/app-manifest.ts). */
export default function manifest(): MetadataRoute.Manifest {
  return appManifest("dark");
}
