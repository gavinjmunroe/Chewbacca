/**
 * Every expo-* package with no behavior the tests depend on. Same rule as
 * empty.mjs: present so the import resolves, loud if anything calls it.
 *
 * Deliberately NOT a bag of no-ops. A no-op stub of expo-haptics is harmless,
 * but the same file also stands in for expo-contacts and expo-secure-store, and
 * a no-op there would let a test "pass" while reading nothing and writing
 * nowhere.
 */
const thrower = (name) =>
  new Proxy(function stub() { throw new Error(`test stub: "${name}" was called; give it a real stub if a test needs it.`); },
    { get: (_t, prop) => (typeof prop === 'symbol' ? undefined : thrower(`${name}.${String(prop)}`)) });
export default thrower('expo');
