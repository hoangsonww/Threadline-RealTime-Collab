import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const upstreamApi = process.env.THREADLINE_API_ORIGIN?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    if (!upstreamApi) return [];
    return [{ source: "/api/identity/:path*", destination: `${upstreamApi}/:path*` }];
  },
};

// Wrapping is safe with no SENTRY_AUTH_TOKEN configured — the plugin just
// skips source map upload (with a log line) instead of failing the build.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: "threadline-web",
  silent: !process.env.CI,
});
