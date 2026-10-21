export default function JobsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-36 bg-white/[0.06] rounded-xl" />
      {/* Filter pills skeleton */}
      <div className="flex gap-3 flex-wrap">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-7 w-20 bg-white/[0.04] border border-white/[0.07] rounded-full" />
        ))}
      </div>
      {/* Job card skeletons */}
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 h-32" />
        ))}
      </div>
    </div>
  );
}
