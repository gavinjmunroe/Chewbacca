/**
 * retell/index.js — public surface of the Retell adapter.
 *
 * Importers should only touch this barrel; the submodules are
 * implementation detail and may move.
 */

export {
  isConfigured,
  describeConfig,
  createPhoneCall,
  createAgent,
} from "./adapter.js";
export {
  buildDynamicVariables,
  RETELL_KNOWN_VARIABLE_KEYS,
} from "./variables.js";
export { setRetellClientFactory } from "./client.js";
export { loadRetellConfig } from "./config.js";
