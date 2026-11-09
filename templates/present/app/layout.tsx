import type { Metadata } from "next";
import { TITLE, PRESENTER } from "@/lib/beats";
import "./globals.css";

// Both come from the script file. One talk's title used to be hardcoded here,
// so every generated app was named after somebody else's presentation.
export const metadata: Metadata = {
  title: TITLE,
  description: PRESENTER ? `${TITLE}. ${PRESENTER}.` : TITLE,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
