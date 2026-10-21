// Keep already-installed development clients working after the service rename.
export const AMBER_ID_ORIGIN = 'https://amber-id-production.up.railway.app';
const RETIRED_ID_ORIGIN = 'https://medha-id-production.up.railway.app';
export function resolveAmberIdOrigin(configured?: string): string {
  const origin = configured?.trim().replace(/\/+$/, '');
  return !origin || origin === RETIRED_ID_ORIGIN ? AMBER_ID_ORIGIN : origin;
}
