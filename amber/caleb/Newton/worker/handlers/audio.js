// audio job handler (placeholder).
//
// The production transcription path currently lives in
// Newton/agent/lib/tools/transcribe.js (transcribeAudio, not exported).
// Promoting it to a stable export and wiring it here is a follow-up;
// for now this handler only logs the payload shape so the queue plumbing
// can be verified end to end without touching production code.

export async function handle(payload) {
  const keys =
    payload && typeof payload === "object" ? Object.keys(payload) : [];
  console.log("[worker:audio] placeholder invoked", { keys });
  return { skipped: true, reason: "placeholder" };
}
