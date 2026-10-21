export default function VerifyDetailLoading() {
  return (
    <div className="max-w-2xl space-y-8 animate-pulse">
      <div className="h-5 w-32 bg-white/[0.05] rounded-lg" />
      {/* Dancer header card */}
      <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 space-y-5">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full bg-white/[0.08] shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-44 bg-white/[0.07] rounded-xl" />
            <div className="h-4 w-32 bg-white/[0.05] rounded-lg" />
            <div className="h-4 w-48 bg-white/[0.05] rounded-lg" />
          </div>
        </div>
        <div className="flex gap-4 pt-4 border-t border-white/[0.07]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white/[0.04] rounded-xl px-4 py-2.5 h-14 w-28" />
          ))}
        </div>
      </div>
      {/* Eval form skeleton */}
      <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-6 h-64" />
    </div>
  );
}
