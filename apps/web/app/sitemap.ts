import type { MetadataRoute } from "next";
import { absoluteUrl, publicRoutes } from "../lib/site";

/**
 * The sitemap, derived from the same route list `robots.ts` and `/llms.txt`
 * read. Adding a public page in one place makes it discoverable in all three.
 *
 * `lastModified` is the build time rather than a hand-maintained date: a
 * checked-in date is wrong the moment the page changes without someone
 * remembering to edit it, and a crawler that learns a site's dates are
 * unreliable stops weighting them.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return publicRoutes.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
