/**
 * Schema.org structured data, emitted as JSON-LD.
 *
 * Structured data is the only part of a page a search engine reads
 * *declaratively* rather than inferring — it is how the site gets a rich result
 * instead of a blue link. Everything here is built from {@link site},
 * so the marked-up description and the meta description cannot disagree, which
 * is the failure mode that gets structured data ignored.
 *
 * @module
 */

import { absoluteUrl, publicRoutes, siteDescription, siteLinks, siteName, siteSummary, siteUrl } from "./site";

/**
 * A JSON-LD node. Loose by necessity — schema.org is an open vocabulary and a
 * stricter type would only be a partial transcription of it that goes stale.
 */
export type JsonLd = Record<string, unknown>;

/**
 * The application itself.
 *
 * `SoftwareApplication` rather than `WebApplication` because Threadline is also
 * installable as a PWA, and `offers` is declared with a zero price rather than
 * omitted — an absent `offers` is read as "price unknown", which suppresses the
 * result, whereas an explicit free price does not.
 */
export const softwareApplicationSchema = (): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${siteUrl}/#software`,
  name: siteName,
  url: siteUrl,
  description: siteSummary,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Collaboration",
  operatingSystem: "Any — runs in a modern browser",
  browserRequirements: "Requires a browser with WebRTC and WebSocket support",
  softwareHelp: { "@type": "CreativeWork", url: siteLinks.documentation },
  featureList: [
    "Live WebRTC video, audio, and screen sharing",
    "Shared whiteboard synced across every participant",
    "Shared notes and a shared code editor",
    "Direct peer-to-peer file transfer",
    "Durable room records that persist after the call ends",
    "Organization and room-level attribute-based access control",
    "First-party OpenID Connect provider",
    "Installable as a progressive web app",
  ],
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
  },
  isAccessibleForFree: true,
  screenshot: absoluteUrl("/opengraph-image"),
  publisher: { "@id": `${siteUrl}/#organization` },
});

/** The publisher. Referenced by `@id` from the other nodes rather than repeated. */
export const organizationSchema = (): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${siteUrl}/#organization`,
  name: siteName,
  url: siteUrl,
  description: siteDescription,
  logo: { "@type": "ImageObject", url: absoluteUrl("/icon-512"), width: 512, height: 512 },
  sameAs: [siteLinks.repository],
});

/**
 * The site as a whole, including the sitewide search action.
 *
 * There is no public search endpoint, so `potentialAction` is deliberately
 * omitted — declaring a search action that 404s is worse than declaring none.
 */
export const webSiteSchema = (): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${siteUrl}/#website`,
  name: siteName,
  url: siteUrl,
  description: siteDescription,
  inLanguage: "en-US",
  publisher: { "@id": `${siteUrl}/#organization` },
});

/**
 * Answers to the questions the landing page actually gets asked.
 *
 * Every answer here is a claim the product has to keep — an FAQ that overstates
 * what the software does is a support burden with rich-result styling.
 */
export const faqSchema = (): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": `${siteUrl}/#faq`,
  mainEntity: [
    {
      "@type": "Question",
      name: "What is a Threadline room?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A room is both a live session — video, audio, screen share, whiteboard, shared notes, a shared code editor, peer-to-peer file transfer, and chat — and the durable record of what happened in it. When the call ends the room stays, with its history intact, rather than being discarded.",
      },
    },
    {
      "@type": "Question",
      name: "Does Threadline record video calls?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. Audio and video travel directly between participants over a peer-to-peer WebRTC mesh and are never recorded or relayed through a server. What persists is the collaborative artefacts — whiteboard, notes, editor contents, and chat — not the call itself.",
      },
    },
    {
      "@type": "Question",
      name: "How does Threadline handle access control?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Every room and organization resource is protected by attribute-based access control evaluated in a single policy module. The three services deliberately do not trust one another's enforcement: the realtime tier verifies a room ticket independently rather than accepting that the API already checked.",
      },
    },
    {
      "@type": "Question",
      name: "Is Threadline open source?",
      acceptedAnswer: {
        "@type": "Answer",
        text: `The full source, architecture documentation, and architecture decision records are published at ${siteLinks.repository}.`,
      },
    },
    {
      "@type": "Question",
      name: "Can Threadline be self-hosted?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. The repository ships Dockerfiles for all three services, a Docker Compose stack including MongoDB, and Kubernetes manifests with development and production kustomize overlays.",
      },
    },
  ],
});

/** Breadcrumbs for a page, given its ancestors. Emitted per-page rather than sitewide. */
export const breadcrumbSchema = (trail: readonly { name: string; path: string }[]): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map((crumb, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: crumb.name,
    item: absoluteUrl(crumb.path),
  })),
});

/** Every public page, as a single `ItemList`. Helps a crawler find them without relying on link discovery. */
export const siteNavigationSchema = (): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  "@id": `${siteUrl}/#navigation`,
  itemListElement: publicRoutes.map((route, index) => ({
    "@type": "SiteNavigationElement",
    position: index + 1,
    name: route.title,
    description: route.summary,
    url: absoluteUrl(route.path),
  })),
});

/**
 * The sitewide graph, as one `@graph` document.
 *
 * A single script tag with a graph is preferable to five separate tags: the
 * `@id` cross-references resolve within one document, so the application, the
 * organization, and the site are understood as one connected description rather
 * than as unrelated fragments that happen to share a page.
 */
export const siteStructuredData = (): JsonLd => ({
  "@context": "https://schema.org",
  "@graph": [
    organizationSchema(),
    webSiteSchema(),
    softwareApplicationSchema(),
    siteNavigationSchema(),
    faqSchema(),
  ].map(({ "@context": _context, ...node }) => node),
});
