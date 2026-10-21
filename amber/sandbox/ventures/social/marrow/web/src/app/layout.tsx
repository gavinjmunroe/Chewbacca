import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Marrow: Recruiting Software for Student Organizations',
  description:
    'Run your entire club recruiting process in one place. Applications, reviews, messaging, and onboarding. No more Google Forms chaos.',
  keywords: [
    'club recruiting',
    'student organization',
    'campus recruiting',
    'application management',
    'org management',
  ],
  authors: [{ name: 'Marrow' }],
  openGraph: {
    title: 'Marrow: Recruiting Software for Student Organizations',
    description:
      'Run your entire club recruiting process in one place. Applications, reviews, messaging, and onboarding. No more Google Forms chaos.',
    type: 'website',
    siteName: 'Marrow',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Marrow: Recruiting Software for Student Organizations',
    description:
      'Run your entire club recruiting process in one place. Applications, reviews, messaging, and onboarding. No more Google Forms chaos.',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="scroll-smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster
            position="top-right"
            richColors
            closeButton
            toastOptions={{
              duration: 4000,
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
