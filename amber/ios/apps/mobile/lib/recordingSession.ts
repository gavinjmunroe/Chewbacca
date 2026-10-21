/** Scope async recorder work to the take that started it, including pre-network file I/O. */
export function createRecordingSession() {
  let generation = 0;
  let active = false;
  let pending: AbortController | null = null;
  return {
    begin() {
      pending?.abort();
      pending = null;
      active = true;
      return ++generation;
    },
    current: () => generation,
    isCurrent: (token: number) => active && token === generation,
    end(token: number) {
      if (token !== generation) return;
      active = false;
      pending?.abort();
    },
    processing(token: number) {
      const controller = new AbortController();
      if (!active || token !== generation) controller.abort();
      else { pending?.abort(); pending = controller; }
      return controller;
    },
  };
}

/** The native clock is valid only while recording; preserve it across pause and native auto-stop. */
export function recordingDurationMs(nativeSeconds: number, cachedMs: number, activeClockMs = 0) {
  const nativeMs = Number.isFinite(nativeSeconds) ? Math.max(0, nativeSeconds * 1000) : 0;
  return Math.round(Math.min(300_000, Math.max(nativeMs, cachedMs, activeClockMs)));
}
