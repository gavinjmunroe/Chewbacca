import Link from "next/link";
import { ArrowRight, Phone, Shield, Sparkles, Zap } from "lucide-react";

export default function LoginPage() {
  return (
    <div className="relative min-h-screen bg-mesh overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-40 pointer-events-none [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div className="absolute -top-32 -right-32 w-[420px] h-[420px] rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-32 w-[420px] h-[420px] rounded-full bg-violet-500/15 blur-3xl pointer-events-none" />

      <div className="relative max-w-md mx-auto pt-24 md:pt-32 px-6 pb-12">
        <Link
          href="/"
          className="inline-flex items-center gap-2 mb-12 group"
          aria-label="Togari home"
        >
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/40 group-hover:shadow-indigo-500/60 transition-all duration-200">
            <Sparkles className="w-5 h-5 text-white" />
          </span>
          <span className="text-zinc-50 text-xl font-semibold tracking-tight">
            Togari
            <span className="text-zinc-500 font-normal pl-2">/ 48 North</span>
          </span>
        </Link>

        <h1 className="text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent leading-[1.1]">
          Sourcing,
          <br />
          compressed.
        </h1>
        <p className="mt-5 text-zinc-400 leading-relaxed">
          Engagements, theses, enrichment, dialer, and digests. One platform.
          Sign in to continue to the 48 North workspace.
        </p>

        <div className="mt-10 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-2xl shadow-black/40">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 mb-4">
            <Shield className="w-3.5 h-3.5" />
            Secured by Auth0 · 48n tenant
          </div>
          <Link
            href="/api/auth/login?returnTo=/"
            className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 cursor-pointer"
          >
            Continue with Auth0
            <ArrowRight className="w-4 h-4" />
          </Link>
          <p className="mt-4 text-xs text-zinc-500 text-center leading-relaxed">
            By continuing you agree to 48 North&apos;s engagement terms and the
            Togari workspace policies.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-3">
          <StatTile
            value="12hrs"
            label="calling cadence"
            icon={Phone}
            tone="indigo"
          />
          <StatTile
            value="$1.27"
            label="cost per company"
            icon={Zap}
            tone="emerald"
          />
          <StatTile
            value="<3min"
            label="thesis enrichment"
            icon={Sparkles}
            tone="violet"
          />
        </div>

        <p className="mt-10 text-center text-[11px] text-zinc-600">
          Togari · 48 North Capital · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

function StatTile({
  value,
  label,
  icon: Icon,
  tone,
}: {
  value: string;
  label: string;
  icon: typeof Phone;
  tone: "indigo" | "emerald" | "violet";
}) {
  const toneClass =
    tone === "indigo"
      ? "text-indigo-300 bg-indigo-500/10 border-indigo-500/30"
      : tone === "emerald"
        ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
        : "text-violet-300 bg-violet-500/10 border-violet-500/30";
  return (
    <div className="bg-zinc-900/60 backdrop-blur-sm border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-all duration-200">
      <span
        className={`grid place-items-center w-7 h-7 rounded-lg border ${toneClass} mb-2`}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">
        {label}
      </div>
    </div>
  );
}
