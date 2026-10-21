/**
 * A working zustand: create(fn) -> a hook-callable store with getState,
 * setState and subscribe. Real behavior, because a store's update semantics
 * (partial merge, subscriber notification) are the thing worth testing.
 */
export function create(createState) {
  let state;
  const listeners = new Set();
  const setState = (partial, replace) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    if (next === state) return;
    state = replace ? next : { ...state, ...next };
    for (const l of [...listeners]) l(state);
  };
  const getState = () => state;
  const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
  const api = { setState, getState, subscribe, destroy: () => listeners.clear() };
  state = createState(setState, getState, api);
  const useStore = (selector = (s) => s) => selector(state);
  return Object.assign(useStore, api);
}
export default create;
