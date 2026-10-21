export default function BookingsLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 w-32 bg-white/[0.06] rounded-xl" />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 h-28" />
        ))}
      </div>
    </div>
  );
}
