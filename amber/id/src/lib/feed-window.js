/** Same half-open local-day contract as agenda; no window retains old feed behavior. */
export function feedWindow(input = {}) {
  const { from, to } = input;
  if (from == null && to == null) return {};
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  const a = Date.parse(from), b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b || b - a > 62 * 86400000) return null;
  return { from: new Date(a).toISOString(), to: new Date(b).toISOString() };
}
