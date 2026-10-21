export type SearchSurface = 'people' | 'calendar';
export function webSearchRequest(surface: SearchSurface, enabled: boolean, text: string) {
  const query = text.trim();
  if (!enabled || query.length < 2) return null;
  return {
    query,
    web: true,
    scope: surface === 'people' ? 'network' as const : 'day' as const,
  };
}
export const communitySourceLabels = { Apple: 'Contacts', Google: 'Gmail' } as const;
export const calendarSources = [
  'Apple Health',
  'Google Calendar',
  'Whoop',
  'Oura',
  'Garmin',
  'Strava',
  'MyChart',
  'Function',
] as const;
