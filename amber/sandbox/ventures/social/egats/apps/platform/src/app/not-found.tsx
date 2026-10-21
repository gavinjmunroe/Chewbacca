import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="text-8xl font-black text-white/5 select-none">404</div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white">Page not found</h1>
          <p className="text-white/40">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
        </div>
        <Link href="/" className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-3 rounded-xl transition-colors">
          Go home
        </Link>
      </div>
    </div>
  );
}
