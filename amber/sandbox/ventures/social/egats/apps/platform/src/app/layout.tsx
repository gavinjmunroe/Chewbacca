import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import CookieConsent from "@/components/cookie-consent";
import { ScrollEffectsInit } from "@/components/ScrollEffectsInit";
import { ReadingProgressBar } from "@/components/ReadingProgressBar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://egats.vercel.app"
  ),
  title: {
    default: "EGATS — Verified Creative Talent",
    template: "%s | EGATS",
  },
  description:
    "Every Great Artist Takes Space. EGATS verifies creative talent in person and connects them with industry recruiters.",
  keywords: ["verified creative talent", "dance talent", "creative verification", "dance jobs", "creative recruiting", "EGATS"],
  icons: { icon: "/egatslogo.png", apple: "/egatslogo.png" },
  alternates: {
    canonical: process.env.NEXT_PUBLIC_APP_URL,
  },
  openGraph: {
    title: "EGATS — Verified Creative Talent",
    description: "Every Great Artist Takes Space. EGATS verifies creative talent in person and connects them with industry recruiters.",
    url: process.env.NEXT_PUBLIC_APP_URL,
    siteName: "EGATS",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "EGATS — Verified Creative Talent" }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EGATS — Verified Creative Talent",
    description: "Every Great Artist Takes Space. EGATS verifies creative talent in person and connects them with industry recruiters.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
    { media: "(prefers-color-scheme: light)", color: "#0a0a0f" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        <ReadingProgressBar />
        <ScrollEffectsInit />
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
