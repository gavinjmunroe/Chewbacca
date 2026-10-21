export function isVoiceDrop(x: number, y: number): boolean {
  'worklet';
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 72 && y < -60;
}
