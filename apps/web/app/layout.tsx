import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "../components/pwa-register";
import { ThemeSync } from "../components/theme-sync";
import { siteColors, siteDescription, siteKeywords, siteName, siteTagline, siteUrl } from "../lib/site";
import { siteStructuredData } from "../lib/structured-data";

const sans = Manrope({ subsets: ["latin"], variable: "--font-geist" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-geist-mono" });

const title = `${siteName} | ${siteTagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: `%s | ${siteName}` },
  description: siteDescription,
  keywords: [...siteKeywords],
  authors: [{ name: siteName, url: siteUrl }],
  creator: siteName,
  publisher: siteName,
  applicationName: siteName,
  category: "productivity",
  referrer: "strict-origin-when-cross-origin",
  formatDetection: { email: false, address: false, telephone: false },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Uncapped preview sizes: the default caps produce a truncated snippet
      // that describes the product less well than the description does.
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: "/",
    types: {
      // Advertised so a model that reads `<link rel>` finds the machine-readable
      // summary without having to guess the well-known path.
      "text/plain": [
        { url: "/llms.txt", title: `${siteName} — summary for language models` },
        { url: "/llms-full.txt", title: `${siteName} — full description for language models` },
      ],
    },
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: siteName },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName,
    title,
    description: siteDescription,
    locale: "en_US",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${siteName} — a room that remembers` }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: siteDescription,
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: siteColors.dark },
    { media: "(prefers-color-scheme: light)", color: siteColors.light },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      data-theme="dark"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Warm up the font origins before the CSS that needs them is parsed. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />

        {/*
          One JSON-LD graph rather than several separate script tags, so the
          `@id` cross-references between the organization, the site, and the
          application resolve within a single document. See lib/structured-data.ts.
        */}
        <script
          type="application/ld+json"
          // The payload is built from build-time constants in this repository —
          // there is no user input anywhere in it.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteStructuredData()) }}
        />
      </head>
      <body>
        <ThemeSync />
        <PwaRegister />
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
