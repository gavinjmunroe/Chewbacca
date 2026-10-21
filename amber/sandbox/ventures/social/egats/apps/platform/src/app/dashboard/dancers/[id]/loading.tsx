export default function DancerProfileLoading() {
  return (
    <div className="max-w-4xl space-y-8 animate-pulse">
      {/* Hero card */}
      <div className="bg-white/[0.04] border border-white/[0.07] rounded-3xl overflow-hidden">
        <div className="h-24 bg-white/[0.06]" />
        <div className="px-8 pb-8">
          <div className="-mt-12 flex items-end gap-6 mb-6">
            <div className="w-24 h-24 rounded-2xl bg-white/[0.08] border-4 border-zinc-950 shrink-0" />
            <div className="flex-1 space-y-2 pb-1">
              <div className="h-7 w-48 bg-white/[0.07] rounded-xl" />
              <div className="h-4 w-32 bg-white/[0.05] rounded-lg" />
            </div>
          </div>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white/[0.04] border border-white/[0.05] rounded-xl px-4 py-3 h-16" />
            ))}
          </div>
          {/* Style pills */}
          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-7 w-20 bg-white/[0.05] rounded-full" />
            ))}
          </div>
        </div>
      </div>
      {/* Content grid */}
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="h-6 w-32 bg-white/[0.06] rounded-xl" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-square bg-white/[0.04] border border-white/[0.07] rounded-xl" />
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-5 h-48" />
        </div>
      </div>
    </div>
  );
}
