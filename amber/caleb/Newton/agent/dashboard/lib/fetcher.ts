/**
 * Shared SWR fetcher for all dashboard data fetching.
 * Replaces fetch-in-useEffect pattern across all pages.
 */

export const fetcher = (url: string) => fetch(url).then((r) => r.json());
