/**
 * Navigation, recorded rather than performed. `__navigations()` returns every
 * push/replace/back in order, so a test can assert WHERE a screen sends you --
 * which is exactly the kind of thing a redesign drops.
 */
const calls = [];
export const router = {
  push: (to) => { calls.push({ type: 'push', to }); },
  replace: (to) => { calls.push({ type: 'replace', to }); },
  back: () => { calls.push({ type: 'back' }); },
  canGoBack: () => calls.length > 0,
  setParams: (p) => { calls.push({ type: 'setParams', to: p }); },
  navigate: (to) => { calls.push({ type: 'navigate', to }); },
  dismissAll: () => { calls.push({ type: 'dismissAll' }); },
};
export function __navigations() { return [...calls]; }
export function __resetNavigations() { calls.length = 0; }
const needsTree = (name) => () => { throw new Error(`test stub: ${name}() needs a React tree.`); };
export const useRouter = () => router;
export const useLocalSearchParams = needsTree('useLocalSearchParams');
export const usePathname = needsTree('usePathname');
export const useSegments = needsTree('useSegments');
export const useFocusEffect = needsTree('useFocusEffect');
export const Link = needsTree('Link');
export const Stack = needsTree('Stack');
export const Tabs = needsTree('Tabs');
export const Redirect = needsTree('Redirect');
export const SplashScreen = { preventAutoHideAsync: async () => {}, hideAsync: async () => {} };
