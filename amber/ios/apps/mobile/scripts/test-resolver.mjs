/**
 * The resolve hook itself. Runs on the loader thread, so it takes its
 * configuration through `initialize` rather than importing test-loader.mjs.
 *
 * Two jobs:
 *   1. Redirect a native/framework package to its stub (see test-loader.mjs).
 *   2. Resolve the project's own `@/…` alias, which tsconfig maps to the app
 *      root. Metro and tsc both understand it; plain Node does not, and lib
 *      modules use it for `@/lib/motion`.
 */
let CFG = { stubs: '', app: '', map: {}, expoPrefixes: [] };

export function initialize(data) {
  CFG = data;
}

function stubName(specifier) {
  if (CFG.map[specifier]) return CFG.map[specifier];
  const pkg = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  if (CFG.map[pkg]) return CFG.map[pkg];
  if (specifier === 'expo' || CFG.expoPrefixes.some((p) => specifier.startsWith(p))) {
    return 'expo-generic.mjs';
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    // tsconfig paths: "@/*" -> the app root. Left to Node this is a bare
    // specifier and fails as a missing package, which reads like a broken
    // import rather than a missing alias.
    const rest = specifier.slice(2);
    const url = new URL(rest, CFG.app);
    // The alias is written without an extension in source, the way Metro
    // accepts it. Try the real file shapes in the order Metro would.
    for (const candidate of [url.href, `${url.href}.ts`, `${url.href}.tsx`, `${url.href}/index.ts`, `${url.href}/index.tsx`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        /* try the next shape */
      }
    }
  }
  const stub = stubName(specifier);
  if (stub) {
    return { url: new URL(stub, CFG.stubs).href, shortCircuit: true, format: 'module' };
  }
  // EXTENSIONLESS RELATIVE IMPORTS. The whole source tree writes
  // `from '../components/TabBar'`, which Metro and tsc both resolve and Node
  // does not. Without this, importing any module that reaches a component fails
  // at load with "Cannot find module" -- which reads like a broken import and is
  // really just a bundler convention Node has never had.
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      const base = new URL(specifier, context.parentURL).href;
      for (const ext of ['.ts', '.tsx', '.mts', '.js', '/index.ts', '/index.tsx', '/index.js']) {
        try {
          return await nextResolve(base + ext, context);
        } catch {
          /* try the next shape */
        }
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
