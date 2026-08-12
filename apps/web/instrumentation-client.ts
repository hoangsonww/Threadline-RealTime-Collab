// Runs in the browser. Next.js loads this automatically by filename
// convention — no import wiring needed elsewhere.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
});

// Required so App Router client-side navigations show up as their own
// transactions instead of only the initial page load.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
