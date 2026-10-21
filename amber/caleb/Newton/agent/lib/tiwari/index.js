/**
 * Tiwari Router: 4-bucket architecture for amber-agent.
 *
 * Message In -> Tiwari Router -> Bucket Decision
 *                                    |
 *         +--------------+------------+------------+-------------+
 *         |              |            |            |             |
 *    1. SEARCH    2. CONTEXT    3. VISUALIZE   4. PEOPLERANK
 *     (Exa API)  (Perplexity)    (Loop API)    (togari-peoplerank
 *                                               + Newton signals)
 *
 * Import as: import { tiwari } from './tiwari/index.js'
 * Or import specific functions: import { callPerplexity } from './tiwari/context.js'
 */

// Context bucket (Perplexity AI)
import {
  callPerplexity,
  callPerplexityLight,
  perplexityDeepResearch,
  perplexityEmbed,
} from "./context.js";

// Search bucket (Exa)
import {
  exaSearch,
  exaGetContents,
  exaFindSimilar,
  mightNeedSearch,
} from "./search.js";

// Visualize bucket (Loop / iMessage)
import {
  sendMessage,
  sendTapback,
  formatForIMessage,
  segmentAndSend,
} from "./visualize.js";

// Peoplerank bucket (togari-peoplerank + Newton re-rank)
import { listBuild } from "./peoplerank.js";

// Named namespace object for tiwari.search.*, tiwari.context.*, tiwari.visualize.*, tiwari.peoplerank.*
export const tiwari = {
  context: {
    callPerplexity,
    callPerplexityLight,
    perplexityDeepResearch,
    perplexityEmbed,
  },
  search: {
    exaSearch,
    exaGetContents,
    exaFindSimilar,
    mightNeedSearch,
  },
  visualize: {
    sendMessage,
    sendTapback,
    formatForIMessage,
    segmentAndSend,
  },
  peoplerank: {
    listBuild,
  },
};

// Also export everything flat for direct imports
export {
  // Context
  callPerplexity,
  callPerplexityLight,
  perplexityDeepResearch,
  perplexityEmbed,
  // Search
  exaSearch,
  exaGetContents,
  exaFindSimilar,
  mightNeedSearch,
  // Visualize
  sendMessage,
  sendTapback,
  formatForIMessage,
  segmentAndSend,
  // Peoplerank
  listBuild,
};
