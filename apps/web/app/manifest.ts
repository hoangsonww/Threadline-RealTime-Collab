import type { MetadataRoute } from "next";
import { siteColors, siteDescription, siteName, siteTagline } from "../lib/site";

/**
 * The web app manifest. Colors and copy come from `lib/site.ts` so the
 * installed app, the theme-color meta tag, and the share card cannot disagree
 * about what this product is called or what color its chrome is.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: `${siteName} — ${siteTagline.toLowerCase()}`,
    short_name: siteName,
    description: siteDescription,
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: siteColors.dark,
    theme_color: siteColors.dark,
    categories: ["productivity", "business"],
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
