export default function NotificationsLoading() {
  return (
    <div className="min-h-screen bg-[#09090B] px-4 py-10 max-w-2xl mx-auto animate-pulse">
      <div className="flex items-center justify-between mb-8">
        <div className="h-7 w-40 bg-white/[0.06] rounded-xl" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-4 px-4 py-4 rounded-2xl bg-white/[0.04] border border-white/[0.07]">
            <div className="w-9 h-9 rounded-xl bg-white/[0.06] shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 bg-white/[0.06] rounded-lg" />
              <div className="h-3 w-64 bg-white/[0.04] rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
