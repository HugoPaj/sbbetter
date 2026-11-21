import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SBB Mobile (prototype)",
    short_name: "SBB",
    start_url: "/plan",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#eb0000",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
