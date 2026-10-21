/** Keep established notification destinations working during the migration. */
export function shouldUseRedesignedRoute(
  dev: boolean,
  enabled: string | undefined,
  params: { tab?: unknown; reminder?: unknown; dm?: unknown; legacy?: unknown },
): boolean {
  return (!dev || enabled === '1') && !params.tab && !params.reminder && !params.dm && !params.legacy;
}
