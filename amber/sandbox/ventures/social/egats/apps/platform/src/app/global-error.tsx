"use client";
import { useEffect } from "react";
import { captureException } from "@/lib/monitoring";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { captureException(error); }, [error]);
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
        <div className="text-center space-y-6 max-w-md">
          <div className="text-8xl font-black text-white/5 select-none">500</div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
            <p className="text-white/40">An unexpected error occurred. Our team has been notified.</p>
            {error.digest && <p className="text-xs text-white/20 font-mono">Error ID: {error.digest}</p>}
          </div>
          <button onClick={reset} className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-3 rounded-xl transition-colors">
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
