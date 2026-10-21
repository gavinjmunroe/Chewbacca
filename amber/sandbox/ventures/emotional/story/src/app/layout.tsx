import type { Metadata } from "next";
import { Inter, DM_Sans } from "next/font/google";
import "./globals.css";
import "aos/dist/aos.css";
import AOSInit from "@/components/AOSInit";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const metadata: Metadata = {
  title: "Story",
  description: "A verified-human social platform fighting AI slop, polarization, and attention collapse. Built for authentic connection, reflection, and community. Not dopamine.",
  keywords: ["social media", "human connection", "verified human", "anti-AI", "community", "storytelling"],
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "Story",
    description: "Social media rebuilt for humans.",
    type: "website",
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
