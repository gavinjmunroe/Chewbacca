import { errorResult } from './tools/_result.js';

// A bound credential is a capability for one account, never an account selector.
export function ownerBoundHandler(tool, ownerDid) {
  if (!ownerDid) return tool.handler; // trusted, unbound service/stdio callers
  if (!tool.requiresOwnerDid) return null;
  return (args = {}, extra) => {
    if (args.did != null && args.did !== ownerDid) {
      return errorResult('owner_mismatch', 'This key can only access its own Amber account. Omit did.');
    }
    return tool.handler({ ...args, did: ownerDid }, extra);
  };
}
