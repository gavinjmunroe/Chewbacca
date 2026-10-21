import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" })

export const metadata: Metadata = {
  title: {
    default: "ClearOut - AI Communication Command Center",
    template: "%s | ClearOut",
  },
  description:
    "ClearOut is the AI-native platform that helps you review, respond to, organize, and resolve the overwhelming flood of messages across email, Slack, iMessage, and more - from one intelligent control center.",
  keywords: [
    "AI inbox",
    "email management",
    "communication overload",
    "AI assistant",
    "inbox zero",
    "message triage",
    "Slack management",
    "voice AI",
  ],
  authors: [{ name: "ClearOut" }],
  creator: "ClearOut",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://clearout.so",
    siteName: "ClearOut",
    title: "ClearOut - AI Communication Command Center",
    description:
      "Stop drowning in messages. ClearOut connects all your communication channels and helps you clear what matters with AI intelligence.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "ClearOut",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ClearOut - AI Communication Command Center",
    description: "Stop drowning in messages. ClearOut gives you your communication life back.",
    images: ["/og.png"],
    creator: "@clearout_so",
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  themeColor: "#0F0F14",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} min-h-screen bg-co-dark text-foreground`}>
        {children}
      </body>
    </html>
  )
}
