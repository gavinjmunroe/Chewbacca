import type { Metadata } from "next";
import { Inter, DM_Sans } from "next/font/google";
import "./globals.css";
import "aos/dist/aos.css";
import AOSInit from "@/components/AOSInit";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });

// Issue 116: metadataBase added to suppress Next.js open-graph URL warnings
export const metadata: Metadata = {
  metadataBase: new URL('https://tizzy-psi.vercel.app'),
  title: "Tizzy",
  description: "An always-wearable conversation coach. Real-time haptic coaching, post-conversation review, and long-term skill tracking. Radical respect for privacy.",
  keywords: ["conversation coach", "wearable", "social skills", "assistive technology", "haptics", "autism"],
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "Tizzy: Conversation Coach",
    description: "Real-time haptic coaching for better conversations.",
    type: "website",
    images: [{ url: "/tizzycropped.png", width: 200, height: 200, alt: "Tizzy" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${dmSans.variable} antialiased`}>
        <AOSInit />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
