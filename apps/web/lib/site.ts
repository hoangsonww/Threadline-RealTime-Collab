/**
 * Single source of truth for everything a crawler, a share card, a manifest, or
 * an LLM reads about this site.
 *
 * Before this module existed the canonical origin was written out in four
 * separate files — `layout.tsx`, `robots.ts`, `sitemap.ts`, and `manifest.ts` —
 * which is exactly the shape of duplication that produces a sitemap pointing at
 * one host and a canonical tag pointing at another. Import from here instead of
 * writing a URL, a description, or a route list by hand.
 *
 * @module
 */

/**
 * The canonical public origin, without a trailing slash.
 *
 * Overridable via `NEXT_PUBLIC_SITE_URL` so a preview deployment advertises
 * itself rather than the production host — a preview whose canonical tag points
 * at production is worse than one with no canonical tag at all, because search
 * engines act on it.
 */
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://threadline-rtc.vercel.app").replace(/\/$/, "");

/** The product name, as it appears in titles, share cards, and the manifest. */
export const siteName = "Threadline";

/** The one-line positioning statement. Kept under 160 characters for search results. */
export const siteTagline = "Persistent engineering collaboration";

/**
 * The default meta description. Deliberately concrete about what a room *is*,
 * because "collaboration platform" describes a hundred products and this one's
 * distinguishing claim — that the room outlives the call — is the reason to
 * click.
 */
export const siteDescription =
  "A room-centered workspace for live engineering collaboration and durable session records. Meet now, keep the thread, and return to a room that remembers.";

/** Longer prose for `llms.txt` and structured data, where 160 characters is not the constraint. */
export const siteSummary =
  "Threadline is a room-centered collaboration workspace for engineering teams. A room is both a live session — video, audio, screen share, whiteboard, chat, shared code editor, peer-to-peer file transfer — and a durable record of what happened in it. Nothing is discarded when the call ends.";

/** Search keywords. Ordered by how specifically each one describes this product. */
export const siteKeywords = [
  "engineering collaboration",
  "team rooms",
  "live pair programming",
  "whiteboard collaboration",
  "incident response tool",
  "durable meeting notes",
  "WebRTC video call",
  "developer productivity",
  "persistent collaboration workspace",
  "real-time code editor",
] as const;

/** Repository and deployment links, reused by structured data and `llms.txt`. */
export const siteLinks = {
  repository: "https://github.com/hoangsonww/Threadline-RealTime-Collab",
  documentation: "https://github.com/hoangsonww/Threadline-RealTime-Collab/tree/main/docs",
  architecture: "https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/architecture.md",
  security: "https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/security.md",
  api: "https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/api.md",
} as const;

/** Brand colors, mirrored from `globals.css` so the manifest and theme tags cannot drift from it. */
export const siteColors = {
  dark: "#101216",
  light: "#ffffff",
} as const;

/**
 * A public route: one that an unauthenticated visitor can reach and that a
 * crawler should therefore be allowed to index.
 */
export type PublicRoute = {
  /** Path, rooted at the origin. */
  readonly path: string;
  /** Title fragment, used in the sitemap and in per-page metadata. */
  readonly title: string;
  /** What the page is for, in one sentence. Feeds `llms.txt`. */
  readonly summary: string;
  /** Sitemap change frequency. */
  readonly changeFrequency: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  /** Sitemap priority, 0–1. */
  readonly priority: number;
};

/**
 * Every publicly reachable route.
 *
 * `robots.ts`, `sitemap.ts`, and the `llms.txt` handlers all derive from this
 * list, so adding a public page here is enough to make it discoverable
 * everywhere — and forgetting to add one keeps it consistently undiscoverable
 * rather than half-listed.
 */
export const publicRoutes: readonly PublicRoute[] = [
  {
    path: "/",
    title: siteTagline,
    summary: "Landing page: what a Threadline room is, and why the record outliving the call is the point.",
    changeFrequency: "monthly",
    priority: 1,
  },
  {
    path: "/register",
    title: "Create an account",
    summary: "Account creation. Issues recovery codes at registration; there is no email-verification step.",
    changeFrequency: "yearly",
    priority: 0.8,
  },
  {
    path: "/login",
    title: "Sign in",
    summary: "Sign in with an existing account, or start the first-party OIDC authorization code flow.",
    changeFrequency: "yearly",
    priority: 0.5,
  },
  {
    path: "/forgot-password",
    title: "Recover your account",
    summary: "Begin account recovery, either with a recovery code or with an emailed link where mail is configured.",
    changeFrequency: "yearly",
    priority: 0.2,
  },
  {
    path: "/reset-password",
    title: "Set a new password",
    summary: "Complete a password reset from a recovery code or a reset link.",
    changeFrequency: "yearly",
    priority: 0.1,
  },
];

/**
 * Routes that must never be indexed.
 *
 * Everything behind authentication, plus the OIDC and OAuth surfaces — a
 * crawler following an authorization endpoint produces nothing useful and a
 * great deal of log noise.
 */
export const disallowedRoutes = ["/app", "/app/", "/app/*", "/onboarding", "/oidc/", "/oauth/", "/api/"] as const;

/** Builds an absolute URL from a rooted path. */
export const absoluteUrl = (path: string): string => `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
