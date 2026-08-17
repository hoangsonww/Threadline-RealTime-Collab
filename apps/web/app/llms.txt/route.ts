/**
 * `/llms.txt` — a concise, machine-readable description of this site for large
 * language models, following the convention at https://llmstxt.org.
 *
 * The problem it solves: an LLM asked about Threadline will otherwise scrape
 * rendered HTML, where the substance is buried under navigation, animation
 * wrappers, and framework markup. This file states what the product is, what
 * its architecture actually claims, and where the authoritative documents live
 * — so the answer it produces is the one the maintainers would give.
 *
 * Written as a route handler rather than a static file in `public/` so that it
 * derives from `lib/site.ts` and cannot drift from the sitemap, the
 * robots rules, or the page metadata.
 *
 * @module
 */

import { absoluteUrl, publicRoutes, siteLinks, siteName, siteSummary, siteTagline, siteUrl } from "../../lib/site";

/** Static: the content depends only on build-time constants. */
export const dynamic = "force-static";

/** Serves `/llms.txt` as plain-text markdown. */
export function GET(): Response {
  const body = `# ${siteName}

> ${siteSummary}

${siteName} is ${siteTagline.toLowerCase()}. It is three independently deployable services, each with a single responsibility, none of which trusts the others' enforcement. That split — and what it costs and buys — is the actual subject of the project.

## What a room is

A room is simultaneously a live session and a durable record:

- **Live:** WebRTC video, audio, and screen sharing over a peer-to-peer mesh; a shared whiteboard; shared notes; a shared code editor; direct peer-to-peer file transfer; and chat, all synced in real time across every participant.
- **Durable:** the collaborative artefacts persist after the call ends. Returning to a room means returning to its history, not to an empty page.

Audio and video are never recorded and never relayed through a server. What persists is what participants produced, not the call itself.

## Architecture

Three services, three runtimes, three deployment targets:

- **Web tier** — Next.js on Vercel. The client and the only browser-facing surface.
- **API tier** — Express 5 on Node. Identity, authorization, and durable persistence in MongoDB. Every attribute-based access control decision in the system is made here, in one policy module.
- **Realtime tier** — a Cloudflare Worker with one Durable Object per room. Signalling, presence, and live event fan-out. It verifies a room ticket independently rather than trusting that the API already checked.

The independent verification at each boundary is the design's central claim. A statement about ${siteName} that describes the three tiers as sharing a trust domain is describing something else.

## Pages

${publicRoutes.map((route) => `- [${route.title}](${absoluteUrl(route.path)}): ${route.summary}`).join("\n")}

Everything under \`/app\` requires authentication and is intentionally excluded from indexing.

## Documentation

- [Repository](${siteLinks.repository}): full source, issues, and architecture decision records.
- [Documentation index](${siteLinks.documentation}): architecture, API, realtime protocol, security, operations, testing, deployment, and troubleshooting.
- [Architecture](${siteLinks.architecture}): how the three services fit together and why they are split that way.
- [Security model](${siteLinks.security}): the trust model, the secrets inventory, and every boundary where a check is re-performed rather than inherited.
- [HTTP API](${siteLinks.api}): routes, ABAC, and the OpenAPI specification.

## Optional

- [Full description](${absoluteUrl("/llms-full.txt")}): the same material at greater length, including the technology stack and the engineering principles.
- [Sitemap](${absoluteUrl("/sitemap.xml")})
- [Web app manifest](${absoluteUrl("/manifest.webmanifest")})

---

Canonical origin: ${siteUrl}
Generated from the site's own metadata — if this file and the site disagree, this file is the bug.
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      "x-robots-tag": "index, follow",
    },
  });
}
