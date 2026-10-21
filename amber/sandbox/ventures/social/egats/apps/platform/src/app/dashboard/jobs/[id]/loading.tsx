export default function JobDetailLoading() {
  return (
    <div className="space-y-8 max-w-4xl animate-pulse">
      <div className="h-5 w-28 bg-white/[0.05] rounded-lg" />
      <div className="bg-white/[0.04] border border-white/[0.07] rounded-3xl p-8 space-y-6">
        {/* Title + badges */}
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="h-6 w-24 bg-white/[0.06] rounded-full" />
            <div className="h-6 w-20 bg-white/[0.06] rounded-full" />
          </div>
          <div className="h-8 w-72 bg-white/[0.07] rounded-xl" />
          <div className="h-5 w-40 bg-white/[0.05] rounded-lg" />
        </div>
        {/* Stats grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-4 h-16" />
          ))}
        </div>
        {/* Description block */}
        <div className="space-y-2">
          <div className="h-4 bg-white/[0.05] rounded-lg" />
          <div className="h-4 w-5/6 bg-white/[0.05] rounded-lg" />
          <div className="h-4 w-4/6 bg-white/[0.05] rounded-lg" />
        </div>
      </div>
    </div>
  );
}
