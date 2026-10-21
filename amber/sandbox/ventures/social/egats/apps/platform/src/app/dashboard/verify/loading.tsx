export default function VerifyLoading() {
  return (
    <div className="min-h-screen bg-[#09090B] text-white animate-pulse">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-10">
          <div className="h-7 w-48 bg-white/[0.06] rounded-xl" />
        </div>
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-5 h-20" />
          ))}
        </div>
      </div>
    </div>
  );
}
