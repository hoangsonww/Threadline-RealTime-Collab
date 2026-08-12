// Imported as the very first line of index.ts, before any other module, so
// Sentry can instrument everything that loads after it. Safe to import even
// with no SENTRY_DSN configured — Sentry.init() is simply skipped, and every
// Sentry.* call elsewhere in the app already no-ops without an active client.
import "dotenv/config";
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  });
}
