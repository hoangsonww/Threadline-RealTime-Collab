import type { NextConfig } from "next";

const upstreamApi = process.env.THREADLINE_API_ORIGIN?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    if (!upstreamApi) return [];
    return [{ source: "/api/identity/:path*", destination: `${upstreamApi}/:path*` }];
  },
};

export default nextConfig;
