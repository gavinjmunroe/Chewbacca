export default function CampsLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 w-40 bg-white/[0.06] rounded-xl" />
      {/* Info banner skeleton */}
      <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 h-36" />
      {/* Camp list skeletons */}
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 h-36" />
        ))}
      </div>
    </div>
  );
}
