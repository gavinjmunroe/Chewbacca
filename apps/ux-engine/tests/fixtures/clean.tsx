export function Hero() {
  return (
    <section className="bg-black px-6 py-24">
      <h1 className="font-display text-5xl font-normal tracking-[4px] text-white">
        Chiron Super Sport 300+
      </h1>
      <p className="mt-6 max-w-[65ch] text-neutral-400">
        Four hundred and ninety kilometres per hour, recorded at Ehra-Lessien
        on 2 August 2019 with Andy Wallace driving.
      </p>
      <a href="/configure" className="mt-10 inline-block border border-neutral-700 px-8 py-3 text-white transition-colors duration-150 hover:border-white">
        Configure
      </a>
    </section>
  );
}
