export interface ExaSearchOptions {
  type?: 'neural' | 'keyword'; // default 'neural'
  useAutoprompt?: boolean; // default true
  numResults?: number; // default 10
  includeText?: boolean; // default true
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string; // ISO date
  endPublishedDate?: string;
}

export interface ExaSearchResult {
  url: string;
  title: string;
  text?: string;
  publishedDate?: string;
  author?: string;
  score: number;
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  autopromptString?: string;
}

export interface ExaContentsOptions {
  text?: boolean | { maxCharacters?: number };
  highlights?: boolean | { numSentences?: number };
  summary?: boolean | { query?: string };
}

export interface ExaContentsResult {
  url: string;
  title: string;
  text?: string;
  highlights?: string[];
  summary?: string;
}

export interface CompanyEnrichmentResult {
  domain: string;
  name?: string;
  description?: string;
  industry?: string;
  employeeCount?: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
  socialProfiles?: {
    linkedin?: string;
    twitter?: string;
  };
  technologies?: string[];
  funding?: string;
  foundedYear?: number;
  sources: string[]; // URLs used for enrichment
  confidence: number;
}

export interface ContactEnrichmentResult {
  email?: string;
  fullName?: string;
  title?: string;
  company?: string;
  linkedinUrl?: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
  sources: string[];
  confidence: number;
}
