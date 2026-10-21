/** Same contract as async-storage, separate namespace. */
const store = new Map();
export async function getItemAsync(key) { return store.has(key) ? store.get(key) : null; }
export async function setItemAsync(key, value) { store.set(key, String(value)); }
export async function deleteItemAsync(key) { store.delete(key); }
export async function isAvailableAsync() { return true; }
export function __reset() { store.clear(); }
export const WHEN_UNLOCKED = 'WHEN_UNLOCKED';
export const AFTER_FIRST_UNLOCK = 'AFTER_FIRST_UNLOCK';
export default { getItemAsync, setItemAsync, deleteItemAsync, isAvailableAsync };
