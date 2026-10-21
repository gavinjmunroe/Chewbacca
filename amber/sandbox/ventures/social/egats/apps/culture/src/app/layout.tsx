import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://egats-culture.vercel.app"
  ),
  title: "EGATS Culture",
  description:
    "EGATS Culture is a dance-first social platform where every post includes the performance and the story behind it. Context, credit, and craft — not just content.",
  icons: { icon: "/egatslogocropped.png", apple: "/egatslogocropped.png" },
  openGraph: {
    title: "EGATS Culture",
    description: "Every post has a performance AND a story. Rebuild norms around context, credit, and authenticity.",
    images: [{ url: "/egatslogocropped.png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ WebkitFontSmoothing: "antialiased" }}>{children}</body>
    </html>
  );
}
