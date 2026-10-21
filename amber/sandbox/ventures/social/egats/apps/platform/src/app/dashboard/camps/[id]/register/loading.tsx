export default function CampRegisterLoading() {
  return (
    <div className="max-w-3xl space-y-8 animate-pulse">
      <div className="h-5 w-32 bg-white/[0.05] rounded-lg" />
      <div className="grid lg:grid-cols-5 gap-8">
        {/* Form skeleton */}
        <div className="lg:col-span-3 space-y-5">
          <div className="h-7 w-48 bg-white/[0.07] rounded-xl" />
          <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-24 bg-white/[0.05] rounded" />
                <div className="h-10 bg-white/[0.04] border border-white/[0.07] rounded-xl" />
              </div>
            ))}
            <div className="h-12 bg-white/[0.06] rounded-xl" />
          </div>
        </div>
        {/* Sidebar skeleton */}
        <div className="lg:col-span-2">
          <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 h-64" />
        </div>
      </div>
    </div>
  );
}
