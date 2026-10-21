/**
 * A REAL in-memory AsyncStorage, because persistence is behavior worth testing.
 *
 * Matches the parts of the API this app uses, including the ones that are easy
 * to get wrong: getItem on a missing key resolves to null (not undefined),
 * multiGet returns [key, value] pairs in the order asked, and every method is
 * async. Tests reset it with __reset().
 */
const store = new Map();

const AsyncStorage = {
  async getItem(key) {
    return store.has(String(key)) ? store.get(String(key)) : null;
  },
  async setItem(key, value) {
    if (typeof value !== 'string') {
      throw new Error(`AsyncStorage.setItem expects a string, got ${typeof value}`);
    }
    store.set(String(key), value);
  },
  async removeItem(key) {
    store.delete(String(key));
  },
  async clear() {
    store.clear();
  },
  async getAllKeys() {
    return [...store.keys()];
  },
  async multiGet(keys) {
    return keys.map((k) => [String(k), store.has(String(k)) ? store.get(String(k)) : null]);
  },
  async multiSet(pairs) {
    for (const [k, v] of pairs) store.set(String(k), v);
  },
  async multiRemove(keys) {
    for (const k of keys) store.delete(String(k));
  },
  /** Test-only. */
  __reset() {
    store.clear();
  },
  __dump() {
    return Object.fromEntries(store);
  },
};

export default AsyncStorage;
export const __reset = AsyncStorage.__reset;
export const __dump = AsyncStorage.__dump;
