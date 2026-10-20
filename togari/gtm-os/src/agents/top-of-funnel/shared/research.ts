/**
 * @togari/bma-content/agents/top-of-funnel/shared/research
 * Internal library — NOT an MCP tool
 * Wraps Clay (enrichment), Exa (web research), Structify (extraction) from @togari/core
 * Used by channel agents to build prospect lists
 */

export interface ResearchQuery {
  companyName?: string;
  domain?: string;
  segment?: string;
  persona?: string;
  keywords?: string[];
  limit?: number;
}

export interface ProspectResult {
  companyName: string;
  domain: string;
  contactName: string;
  contactTitle: string;
  contactEmail?: string;
  contactLinkedIn?: string;
  segment: string;
  signals: string[];
  enrichmentSource: 'clay' | 'exa' | 'structify' | 'manual';
  score: number;
}

export interface ResearchResult {
  prospects: ProspectResult[];
  totalFound: number;
  sourcesUsed: string[];
  query: ResearchQuery;
}

/**
 * Research a target list using Clay, Exa, and Structify connectors.
 * Returns scored prospect list for a given channel's build_list tool.
 */
async function buildProspectList(query: ResearchQuery): Promise<ResearchResult> {
  // TODO: Wire up Clay enrichment from @togari/core connectors
  // TODO: Wire up Exa web research from @togari/core connectors
  // TODO: Wire up Structify extraction from @togari/core connectors

  // For now, return a prompt-delegation result that tells Claude what to do
  return {
    prospects: [],
    totalFound: 0,
    sourcesUsed: [],
    query,
  };
}

/**
 * Build a research prompt for Claude to execute.
 * This is what channel agents actually call — returns a prompt string
 * that gets wrapped in the MCP tool response.
 */
function buildResearchPrompt(query: ResearchQuery, channel: string): string {
  return `You are the Research subagent for the ${channel} channel in the BMA GTM OS.

RESEARCH QUERY:
${query.companyName ? `Company: ${query.companyName}` : ''}
${query.domain ? `Domain: ${query.domain}` : ''}
${query.segment ? `Segment: ${query.segment}` : ''}
${query.persona ? `Persona: ${query.persona}` : ''}
${query.keywords ? `Keywords: ${query.keywords.join(', ')}` : ''}
Limit: ${query.limit || 25}

INSTRUCTIONS:
1. Search for prospects matching this query using available web research
2. For each prospect, identify:
   - Company name, domain, segment
   - Contact name, title, email (if findable)
   - LinkedIn profile URL (if findable)
   - Relevant signals (funding, hiring, product launches, regulatory moves)
3. Score each prospect 1-10 based on signal strength and fit
4. Return results sorted by score descending

Return JSON matching the ResearchResult schema with an array of ProspectResult objects.`;
}

export const research = {
  buildProspectList,
  buildResearchPrompt,
};
