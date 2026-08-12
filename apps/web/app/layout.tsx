import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "../components/pwa-register";
import { ThemeSync } from "../components/theme-sync";

const sans = Manrope({ subsets: ["latin"], variable: "--font-geist" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-geist-mono" });

const siteUrl = "https://threadline-rtc.vercel.app";
const siteName = "Threadline";
const description =
  "A room-centered workspace for live engineering collaboration and durable session records. Meet now, keep the thread, and return to a room that remembers.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${siteName} | Persistent engineering collaboration`, template: `%s | ${siteName}` },
  description,
  keywords: [
    "engineering collaboration",
    "team rooms",
    "live pair programming",
    "whiteboard collaboration",
    "incident response tool",
    "durable meeting notes",
    "WebRTC video call",
    "developer productivity",
  ],
  authors: [{ name: siteName }],
  creator: siteName,
  publisher: siteName,
  applicationName: siteName,
  referrer: "strict-origin-when-cross-origin",
  formatDetection: { email: false, address: false, telephone: false },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
  alternates: { canonical: "/" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: siteName },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName,
    title: `${siteName} | Persistent engineering collaboration`,
    description,
    locale: "en_US",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${siteName} — a room that remembers` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteName} | Persistent engineering collaboration`,
    description,
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#101216" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
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
