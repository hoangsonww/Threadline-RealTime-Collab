import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email"],
      disallow: ["/app", "/app/", "/app/*", "/onboarding", "/oidc/", "/oauth/"],
    },
    sitemap: "https://threadline-rtc.vercel.app/sitemap.xml",
  };
}
