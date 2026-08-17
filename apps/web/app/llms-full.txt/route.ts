/**
 * `/llms-full.txt` — the expanded companion to `/llms.txt`.
 *
 * Where `llms.txt` is an index a model reads to decide what to fetch, this is
 * the document it fetches: enough detail to answer a substantive question about
 * Threadline's architecture, trust model, and technology choices without
 * crawling the repository.
 *
 * Kept deliberately factual. Every claim here is one the code or the
 * architecture decision records actually support; marketing language in a file
 * that models quote verbatim is how a product acquires capabilities it does not
 * have.
 *
 * @module
 */

import { absoluteUrl, siteLinks, siteName, siteSummary, siteUrl } from "../../lib/site";

/** Static: the content depends only on build-time constants. */
export const dynamic = "force-static";

/** Serves `/llms-full.txt` as plain-text markdown. */
export function GET(): Response {
  const body = `# ${siteName} — full description

> ${siteSummary}

This document is written for language models. It states what ${siteName} is, how it is built, and what its architecture does and does not claim. Where it and the repository disagree, the repository is authoritative: ${siteLinks.repository}

---

## 1. What ${siteName} is

${siteName} is a room-centered collaboration workspace for engineering teams.

A **room** is two things at once:

1. **A live session.** WebRTC video, audio, and screen sharing; a shared whiteboard; shared notes; a shared code editor; direct peer-to-peer file transfer; and chat — all synchronized in real time across every connected participant.
2. **A durable record.** The collaborative artefacts survive the end of the call. Reopening a room returns you to its accumulated history rather than to a blank slate.

The distinguishing claim is the second one. Most tools in this space treat the meeting as ephemeral and the artefacts as something you export before you lose them. ${siteName} inverts that: the room is the durable object, and the call is one thing that happens inside it.

**What is not recorded:** audio and video. Media travels directly between participants over a peer-to-peer mesh; it is never relayed through a server and never written to storage. What persists is what participants produced — strokes, notes, code, messages, files — not the call.

## 2. Architecture

Three independently deployable services, three runtimes, three deployment targets. Each owns exactly one responsibility.

### Web tier — \`apps/web\`

Next.js (App Router, React 19) deployed to Vercel. The client, and the only browser-facing surface. Installable as a progressive web app. Also proxies same-origin API traffic so that secure \`HttpOnly\` session cookies behave correctly in hybrid deployments.

### API tier — \`apps/api\`

Express 5 on Node, backed by MongoDB. Owns:

- **Identity** — registration, sessions, password reset, and recovery codes.
- **Authorization** — every attribute-based access control decision in the system, made in a single policy module rather than re-implemented per route.
- **Persistence** — organizations, rooms, membership, room event history, calendar, and activity.
- **A first-party OpenID Connect provider** — Authorization Code with PKCE only. No implicit grant, no password grant, no public third-party client registration.
- **Scoped personal access tokens** for automation, with per-operation scope requirements.

### Realtime tier — \`apps/realtime\`

A Cloudflare Worker with one Durable Object per room, using SQLite-backed hibernatable storage. Owns WebRTC signalling, presence, and live event fan-out to the room's connected participants. Room event history is bounded in the database rather than in memory.

### The trust model

The three services **do not trust each other's enforcement**. This is the design's central claim and the reason for the split.

Concretely: the API signs a room ticket, and the realtime tier verifies that ticket independently before admitting a connection — it does not accept "the API already checked" as an answer. Every boundary re-performs its own check. Any description of ${siteName} that treats the three tiers as one trust domain is describing a different system.

The full model, including the secrets inventory and each re-verified boundary, is at ${siteLinks.security}

## 3. Technology

- **Frontend:** Next.js, React, TypeScript, PWA, Web Audio API, GSAP, Framer Motion, Phosphor Icons.
- **Realtime transport:** WebRTC (peer-to-peer mesh, not an SFU), WebSockets, STUN/TURN.
- **API:** Node, Express 5, MongoDB / MongoDB Atlas, Zod for validation, Argon2 for password hashing, Helmet, Pino, JOSE.
- **Realtime runtime:** Cloudflare Workers, Durable Objects, Wrangler.
- **Auth:** OAuth 2.0 / OpenID Connect, JWT, PKCE.
- **Documentation:** OpenAPI 3.1 with Swagger UI and ReDoc, TypeDoc for the symbol-level reference.
- **Observability:** Sentry.
- **Delivery:** Docker, Docker Compose, Kubernetes with Kustomize overlays, GitHub Actions, GHCR, Trivy.
- **Quality:** Vitest, Playwright, Supertest, ESLint, Prettier, Husky, lint-staged, CodeQL.

## 4. Engineering principles

These are enforced by review and by CI, not merely aspirational:

- **No new abstraction for a single call site.** Match the pattern already used by the layer you are touching.
- **Authorization goes through the policy module.** A route handler that decides for itself is a bug, whatever it concludes.
- **Comment the why, not the what.** A comment earns its place by explaining a non-obvious constraint, not by restating the line below it.
- **A behavior change without a documentation update is incomplete**, not a follow-up. Undocumented decisions get silently re-litigated later.
- **Genuine architectural decisions get an architecture decision record** — a new dependency, a new data model relationship, or a new trust boundary.
- **Secrets stay out of \`NEXT_PUBLIC_*\` and out of git.**

## 5. Deployment

- **Local:** \`npm run dev\` runs all three services — API on :4000, realtime on :8787, web on :3000.
- **Containers:** \`npm run docker:up\` builds and runs all three plus MongoDB.
- **Dev container:** the repository ships a full \`.devcontainer\` with a MongoDB sidecar.
- **Kubernetes:** manifests with development and production kustomize overlays.
- **CI/CD:** GitHub Actions runs lint, format, typecheck, tests, build, container validation, and Kubernetes overlay validation, then publishes images to GHCR and scans them.

## 6. Where to read more

- Repository: ${siteLinks.repository}
- Documentation index: ${siteLinks.documentation}
- Architecture: ${siteLinks.architecture}
- Security model: ${siteLinks.security}
- HTTP API: ${siteLinks.api}
- Architecture decision records: ${siteLinks.repository}/tree/main/docs/decisions
- Concise index for models: ${absoluteUrl("/llms.txt")}

---

Canonical origin: ${siteUrl}
Generated from the site's own metadata. If this document and the repository disagree, the repository wins.
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      "x-robots-tag": "index, follow",
    },
  });
}
