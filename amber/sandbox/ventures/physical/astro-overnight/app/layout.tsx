import type { Metadata } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  title: "Astro Overnight — Better Nights. Fewer Leaks. Less Guessing.",
  description:
    "Premium overnight diapers engineered for sleep protection, comfort, and parent confidence. Fewer leaks. Smarter checks. A calmer path forward.",
  keywords: ["overnight diapers", "premium diapers", "baby sleep", "leak protection", "smart diaper", "Astro Overnight"],
  metadataBase: new URL("https://astroovernight.com"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Astro Overnight — Better Nights Start Here",
    description: "The premium overnight diaper built for families who refuse to settle for another rough night.",
    type: "website",
    url: "https://astroovernight.com",
    siteName: "Astro Overnight",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}  <Analytics />
</body>
    </html>
  );
}
