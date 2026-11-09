export function Hero() {
  return (
    <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl p-4 shadow-2xl">
      <h1 className="bg-clip-text text-transparent text-6xl">Empower your team to unlock potential</h1>
      <span className="animate-pulse rounded-full bg-green-500" />
      <button className="bg-indigo-600 hover:scale-105 transition-all rounded-2xl">
        Let's build something together
      </button>
      <input placeholder="Enter your email" />
      <div className="backdrop-blur bg-white/10 rounded-2xl">
        <div className="gap-4 p-4 space-y-4">
          <div className="gap-4 p-4 space-y-4">
            <div className="gap-4 p-4 space-y-4">10k+ users, 99.9% uptime, 24/7 support</div>
          </div>
        </div>
      </div>
      <p className="text-[#6366f1]">01 / FEATURES</p>
    </div>
  );
}
