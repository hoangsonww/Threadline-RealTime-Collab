import type { MetadataRoute } from "next";
import { absoluteUrl, disallowedRoutes, publicRoutes } from "../lib/site";

/**
 * `robots.txt`, derived from the route lists in `lib/site.ts` so that a page
 * added to the sitemap cannot be silently left disallowed, or vice versa.
 *
 * The rules are split in two on purpose:
 *
 * - **Search crawlers** get the public pages and nothing behind authentication.
 * - **AI crawlers** get the same pages *plus* `/llms.txt` and `/llms-full.txt`,
 *   which exist specifically for them. They are allowed rather than blocked:
 *   this project is public and documented, and a model answering questions
 *   about it from the maintainers' own summary is a better outcome than one
 *   answering from a scrape of animated marketing markup.
 */
export default function robots(): MetadataRoute.Robots {
  const allow = [...publicRoutes.map((route) => route.path), "/llms.txt", "/llms-full.txt"];
  const disallow = [...disallowedRoutes];

  return {
    rules: [
      {
        userAgent: "*",
        allow,
        disallow,
      },
      {
        // Named explicitly so the allowance of the llms.txt pair is a stated
        // decision rather than a side effect of the wildcard rule.
        userAgent: [
          "GPTBot",
          "OAI-SearchBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-User",
          "Claude-SearchBot",
          "anthropic-ai",
          "PerplexityBot",
          "Perplexity-User",
          "Google-Extended",
          "Applebot-Extended",
          "CCBot",
          "Bytespider",
          "meta-externalagent",
        ],
        allow,
        disallow,
      },
    ],
    // No `host` directive: it was Yandex-specific, Yandex deprecated it in
    // 2018, and every other crawler ignores it. The canonical origin is
    // asserted by the `<link rel="canonical">` tag instead, which is the
    // mechanism that actually has effect.
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
