import type { Metadata } from "next";
import { Manrope, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
  variable: "--font-source-serif",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://fiduciary.cash"),
  title: {
    default: "FiduciaryOS — Replace Your Advisor, CPA & Consultant",
    template: "%s · FiduciaryOS",
  },
  description:
    "Autonomous wealth management and CPA-replacement AI. AMT planning, ISO/RSU/ESPP equity comp, Schedule D, QSBS §1202, Roth conversion ladder — every decision verified against a signed policy artifact.",
  keywords: [
    "wealth management AI", "fiduciary AI", "CPA replacement", "AMT planning",
    "ISO exercise tax", "RSU tax", "ESPP tax", "Schedule D", "QSBS 1202",
    "backdoor Roth", "Roth conversion ladder", "tax loss harvesting",
  ],
  authors: [{ name: "Caleb Newton", url: "https://fiduciary.cash" }],
  openGraph: {
    title: "FiduciaryOS — Replace Your Advisor, CPA & Consultant",
    description:
      "Autonomous wealth management and CPA-replacement AI. AMT, NIIT, equity comp, Schedule D, QSBS §1202 — all handled. $920B/year in financial services being replaced.",
    url: "https://fiduciary.cash",
    siteName: "FiduciaryOS",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "FiduciaryOS — Replace Your Advisor, CPA & Consultant",
    description:
      "Autonomous wealth management and CPA-replacement AI. AMT, ISO/RSU/ESPP, QSBS §1202, Roth ladder — at 0.1% of human advisor cost.",
    creator: "@calebnewton",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: {
    canonical: "https://fiduciary.cash",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${manrope.variable} ${sourceSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
