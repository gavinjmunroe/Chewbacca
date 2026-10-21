export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="h-8 w-48 bg-white/[0.06] rounded-xl" />

      {/* Stats grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-5 h-28" />
        ))}
      </div>

      {/* Content skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 h-64" />
        <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 h-64" />
      </div>
    </div>
  );
}
