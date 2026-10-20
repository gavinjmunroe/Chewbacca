/**
 * ZoomInfo types — flat Togari domain shape (not ZoomInfo's nested envelope).
 *
 * The raw legacy ZoomInfo API wraps everything in `{ data: { result: [{ data: [...] }] } }`
 * — we strip that wrapper in `normalize.ts` and expose only the fields Togari's
 * agent loop and MCP tools actually use.
 *
 * Add fields here as needed rather than reaching into the raw envelope at the call site.
 */

// ─── Credentials ─────────────────────────────────────────────────────────────

export interface ZoomInfoCredentials {
  username: string;
  clientId: string;
  privateKey: string;
}

// ─── Company shapes ──────────────────────────────────────────────────────────

export interface ZoomInfoCompanySummary {
  companyId: string;
  companyName: string;
  website: string | null;
  industry: string | null;
  revenueRange: string | null;
  employeeRange: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface ZoomInfoCompanyDetail extends ZoomInfoCompanySummary {
  subIndustry: string | null;
  primaryIndustry: string | null;
  yearFounded: number | null;
  phone: string | null;
  street: string | null;
  zipCode: string | null;
  type: string | null;
  numberOfContactsInZoomInfo: number | null;
}

// ─── Person shapes ───────────────────────────────────────────────────────────

export interface ZoomInfoPersonSummary {
  personId: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  companyId: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  hasEmail: boolean;
  hasDirectPhone: boolean;
  hasMobilePhone: boolean;
  contactAccuracyScore: number | null;
}

export interface ZoomInfoPersonDetail extends ZoomInfoPersonSummary {
  email: string | null;
  phone: string | null;
  mobilePhone: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  street: string | null;
  zipCode: string | null;
}

// ─── Raw API envelopes (legacy v1 endpoints) ─────────────────────────────────

export interface ZoomInfoCompanySearchRaw {
  id?: string | number;
  companyId?: string | number;
  name?: string;
  companyName?: string;
  revenue?: string | number | null;
  revenueRange?: string | null;
  employeeCount?: number | null;
  employeeRange?: string | null;
  industry?: string | null;
  subIndustry?: string | null;
  yearFounded?: number | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface ZoomInfoCompanySearchResponse {
  data?: ZoomInfoCompanySearchRaw[];
  companies?: ZoomInfoCompanySearchRaw[];
  totalResults?: number;
  maxResults?: number;
  currentPage?: number;
}

export interface ZoomInfoCompanyEnrichRaw {
  id?: string | number;
  name?: string;
  revenue?: string | number | null;
  revenueRange?: string | null;
  employeeCount?: number | null;
  employeeRange?: string | null;
  industry?: string | null;
  subIndustry?: string | null;
  yearFounded?: number | string | null;
  foundedYear?: number | string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  phone?: string | null;
  street?: string | null;
  zipCode?: string | null;
  primaryIndustry?: string | string[] | null;
  type?: string | null;
  numberOfContactsInZoomInfo?: number | null;
}

export interface ZoomInfoCompanyEnrichResponse {
  success?: boolean;
  data?: {
    result?: Array<{ data?: ZoomInfoCompanyEnrichRaw[] }>;
  };
}

export interface ZoomInfoContactSearchRaw {
  id?: string | number;
  personId?: string | number;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  jobTitle?: string | null;
  contactAccuracyScore?: number | null;
  hasEmail?: boolean;
  hasDirectPhone?: boolean;
  hasMobilePhone?: boolean;
  companyId?: string | number | null;
  companyName?: string | null;
  companyWebsite?: string | null;
}

export interface ZoomInfoContactSearchResponse {
  contacts?: ZoomInfoContactSearchRaw[];
  data?: ZoomInfoContactSearchRaw[];
  maxResults?: number;
  currentPage?: number;
  totalResults?: number;
}

export interface ZoomInfoContactEnrichRaw {
  id?: string | number;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  companyName?: string | null;
  companyId?: string | number | null;
  companyWebsite?: string | null;
  contactAccuracyScore?: number | null;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  externalUrls?: Array<{ type?: string | null; url?: string | null }> | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
}

export interface ZoomInfoContactEnrichResponse {
  success?: boolean;
  data?: {
    result?: Array<{ data?: ZoomInfoContactEnrichRaw[] }>;
  };
}
