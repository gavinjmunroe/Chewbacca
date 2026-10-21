/**
 * THE TESTS RUN WITH NOTHING INSTALLED.
 *
 * Registered by scripts/test.mjs. Maps the native and framework packages to the
 * stubs in scripts/test-stubs/ so a module under test can be imported without
 * node_modules, without Metro, and without a simulator.
 *
 * WHY NOT JUST INSTALL AND IMPORT THE REAL ONES. Three reasons, in order of how
 * much they matter:
 *
 *   1. The real ones cannot run here. react-native's entry point reaches for a
 *      native bridge, expo-contacts wants the contacts permission, expo-audio
 *      wants a recorder. On a Mac in a simulator they work; in any shell they
 *      throw at import time. A suite that can only run in one place is a suite
 *      that stops being run.
 *
 *   2. A test that loads the whole framework is not testing the app. If
 *      importing lib/contactMap.ts pulls in a thousand modules, the slow suite
 *      that results gets scoped down until it is a handful of tests nobody
 *      trusts.
 *
 *   3. The stub is a WRITTEN-DOWN CONTRACT. `AsyncStorage` here is an actual
 *      in-memory key-value store with the real async shape, so a module that
 *      persists something can be tested by reading it back. When a stub is too
 *      thin, the test fails loudly at the missing method rather than passing
 *      over a no-op -- which is the failure mode that makes mocks worthless.
 *
 * THE ONE RULE. A stub may be EMPTY where the code under test does not touch
 * it, but it must never LIE. Nothing here returns a plausible fake value that
 * the real module would compute: no fake contacts, no fake tokens, no fake
 * timestamps. Where behavior matters -- storage, the app-state machine -- the
 * stub implements it honestly and the test drives it. Where it does not, the
 * export throws on use, so a test that reaches it fails instead of quietly
 * asserting against a fiction.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUBS = join(HERE, 'test-stubs');
const APP = join(HERE, '..');

/**
 * specifier (or its package root) → stub file. Anything not listed resolves
 * normally, which is what lets a test import another source file.
 */
const MAP = {
  react: 'react.mjs',
  'react-native': 'react-native.mjs',
  'react-native-reanimated': 'reanimated.mjs',
  'react-native-keyboard-controller': 'keyboard-controller.mjs',
  'react-native-gesture-handler': 'empty.mjs',
  'react-native-svg': 'empty.mjs',
  'react-native-safe-area-context': 'empty.mjs',
  'react-native-pager-view': 'empty.mjs',
  '@react-native-async-storage/async-storage': 'async-storage.mjs',
  '@tanstack/react-query': 'react-query.mjs',
  'expo-router': 'expo-router.mjs',
  'expo-crypto': 'crypto.mjs',
  'expo-secure-store': 'secure-store.mjs',
  'expo-constants': 'expo-constants.mjs',
  zustand: 'zustand.mjs',
  'lucide-react-native': 'empty.mjs',
};

/** Every expo-* / @expo/* package not named above gets the inert stub. */
const EXPO_PREFIXES = ['expo-', '@expo/', '@expo-google-fonts/'];

function stubFor(specifier) {
  if (MAP[specifier]) return MAP[specifier];
  const pkg = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  if (MAP[pkg]) return MAP[pkg];
  if (specifier === 'expo' || EXPO_PREFIXES.some((p) => specifier.startsWith(p))) return 'expo-generic.mjs';
  return null;
}

register(pathToFileURL(join(HERE, 'test-resolver.mjs')), pathToFileURL(HERE + '/'), {
  data: { stubs: pathToFileURL(STUBS + '/').href, app: pathToFileURL(APP + '/').href, map: MAP, expoPrefixes: EXPO_PREFIXES },
});

export { stubFor };
