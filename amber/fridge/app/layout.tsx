import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * NO WEBFONTS AT ALL. The whole site is Georgia, which every browser already
 * has, so there is nothing to fetch and nothing to swap in late.
 *
 * Poppins and Archivo used to be loaded here through Next's Google-font
 * loader. Both are gone; the two variables they fed are declared in
 * globals.css as the same Georgia stack instead, so the thirteen font-family
 * rules across the two stylesheets did not have to be edited one by one.
 *
 * A side effect worth knowing: the production build no longer reaches out to
 * fonts.googleapis.com, which is exactly what used to make `next build` fail in
 * a sandbox with no network access to it.
 */

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://amberintelligence.ai";

const description = "Amber remembers the people on your fridge. Join the waitlist.";

// A function rather than a static object so AMBER_DRAFT is read at request
// time. A review deploy sets it and stays out of search results.
export async function generateMetadata(): Promise<Metadata> {
  const draft = process.env.AMBER_DRAFT === "1";
  return {
    metadataBase: new URL(siteUrl),
    title: "Amber",
    description,
    icons: {
      icon: [{ url: "/favicon.png", type: "image/png" }],
    },
    openGraph: {
      title: "Amber",
      description,
      url: siteUrl,
      siteName: "Amber",
      type: "website",
      images: [{ url: "/logo.png" }],
    },
    robots: draft
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: "#1a0e08",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
