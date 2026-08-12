import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Reports errors from Server Components, Route Handlers, and middleware —
// the client and Node/edge runtimes each report their own separately.
export const onRequestError = Sentry.captureRequestError;
