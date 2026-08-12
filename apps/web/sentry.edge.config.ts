// The edge runtime (middleware, edge routes) has no Node APIs available, so
// this stays intentionally minimal compared to sentry.server.config.ts.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
});
