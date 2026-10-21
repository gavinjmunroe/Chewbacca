/**
 * Enough of react-query for a module to be IMPORTED. Hooks throw if called:
 * nothing in this suite renders a component, so a call means the test wandered
 * into UI that needs the render tier instead.
 */
export class QueryClient {
  constructor(config) { this.config = config; this._data = new Map(); }
  getQueryData(key) { return this._data.get(JSON.stringify(key)); }
  setQueryData(key, v) { this._data.set(JSON.stringify(key), typeof v === 'function' ? v(this.getQueryData(key)) : v); }
  invalidateQueries() { return Promise.resolve(); }
  removeQueries() {}
  clear() { this._data.clear(); }
}
const notInThisTier = (name) => () => {
  throw new Error(`test stub: ${name}() needs a React tree. Test the logic it calls instead.`);
};
export const useQuery = notInThisTier('useQuery');
export const useMutation = notInThisTier('useMutation');
export const useQueryClient = notInThisTier('useQueryClient');
export const QueryClientProvider = notInThisTier('QueryClientProvider');
export const useInfiniteQuery = notInThisTier('useInfiniteQuery');
