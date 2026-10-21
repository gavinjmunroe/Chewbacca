/**
 * A package the code under test imports but never calls in a test: gesture
 * handler, svg, safe-area, the icon set. Any named import resolves to a marker
 * that THROWS if it is called, so a test that actually depends on one of these
 * fails at the call rather than passing over a silent no-op.
 */
const thrower = (name) =>
  new Proxy(
    function stub() {
      throw new Error(
        `test stub: "${name}" was called. Nothing in this suite should need it — ` +
          `either the test is reaching into native code, or the stub needs a real ` +
          `implementation in scripts/test-stubs/.`,
      );
    },
    { get: (_t, prop) => (prop === Symbol.toPrimitive || typeof prop === 'symbol' ? undefined : thrower(`${name}.${String(prop)}`)) },
  );

export default thrower('default');
export const __esModule = true;
