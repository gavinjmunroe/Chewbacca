"use client";
import { useState, useEffect } from "react";

export default function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("egats-cookie-consent");
    if (!consent) setShow(true);
  }, []);

  const accept = () => {
    localStorage.setItem("egats-cookie-consent", "accepted");
    setShow(false);
  };

  const decline = () => {
    localStorage.setItem("egats-cookie-consent", "declined");
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto bg-[rgba(28,28,30,0.97)] backdrop-blur-xl border border-white/10 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-2xl">
        <p className="flex-1 text-sm text-white/60">
          We use cookies to improve your experience. By using EGATS, you agree to our{" "}
          <a href="/privacy" className="text-violet-400 hover:underline">Privacy Policy</a>.
        </p>
        <div className="flex gap-3 shrink-0">
          <button onClick={decline} className="px-4 py-2 text-sm text-white/50 hover:text-white/80 border border-white/10 rounded-xl transition-colors">
            Decline
          </button>
          <button onClick={accept} className="px-4 py-2 text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-colors">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
