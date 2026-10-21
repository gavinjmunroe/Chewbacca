export default function CampDetailLoading() {
  return (
    <div className="max-w-3xl space-y-8 animate-pulse">
      <div className="h-5 w-32 bg-white/[0.05] rounded-lg" />
      <div className="bg-white/[0.04] border border-white/[0.07] rounded-3xl p-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-2">
            <div className="h-8 w-64 bg-white/[0.07] rounded-xl" />
            <div className="flex gap-4">
              <div className="h-4 w-40 bg-white/[0.05] rounded-lg" />
              <div className="h-4 w-32 bg-white/[0.05] rounded-lg" />
            </div>
          </div>
          <div className="h-8 w-20 bg-white/[0.06] rounded-xl" />
        </div>
        {/* Stats grid */}
        <div className="grid sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-4 h-20" />
          ))}
        </div>
        {/* Description */}
        <div className="space-y-2">
          <div className="h-4 bg-white/[0.05] rounded-lg" />
          <div className="h-4 w-5/6 bg-white/[0.05] rounded-lg" />
          <div className="h-4 w-3/4 bg-white/[0.05] rounded-lg" />
        </div>
        {/* CTA */}
        <div className="h-14 w-56 bg-white/[0.06] rounded-xl" />
      </div>
    </div>
  );
}
