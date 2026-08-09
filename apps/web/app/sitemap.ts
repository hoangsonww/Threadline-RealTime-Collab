import type { MetadataRoute } from "next";

const siteUrl = "https://threadline-silk.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${siteUrl}/`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${siteUrl}/login`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${siteUrl}/register`, lastModified: now, changeFrequency: "yearly", priority: 0.8 },
  ];
}
