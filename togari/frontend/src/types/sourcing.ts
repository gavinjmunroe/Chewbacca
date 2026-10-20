export interface User {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  avatar_initial: string;
}

export interface Engagement {
  engagement_id: string;
  tenant_id: string;
  client_firm_name: string;
  client_firm_id: string | null;
  engagement_name: string;
  description: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  primary_owner_id: string;
  created_at: string;
  updated_at: string;
  metrics: {
    theses_count: number;
    companies_count: number;
    meetings_booked: number;
    in_loi: number;
    closed_won: number;
  };
}

export interface Thesis {
  thesis_id: string;
  tenant_id: string;
  engagement_id: string;
  thesis_name: string;
  description: string;
  search_criteria: {
    keywords: string[];
    owner_target_titles: string[];
  };
  industry_codes: string[];
  geo_constraints: string[];
  revenue_range: { min: number; max: number };
  headcount_range: { min: number; max: number };
  status: string;
  primary_owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface Company {
  company_id: string;
  tenant_id: string;
  company_name: string;
  domain: string | null;
  hubspot_id: string | null;
  dealcloud_id: string | null;
  legal_name: string | null;
  description: string | null;
  industry: string | null;
  naics_code: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  estimated_revenue: number | null;
  estimated_headcount: number | null;
  founded_year: number | null;
  linkedin_url: string | null;
  enrichment_status: string;
  enrichment_run_id: string | null;
  fit_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyContact {
  contact_id: string;
  tenant_id: string;
  company_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  title: string | null;
  seniority: string | null;
  email: string | null;
  email_verified: boolean;
  mobile_phone: string | null;
  business_phone: string | null;
  linkedin_url: string | null;
  is_primary: boolean;
  primary_score: number | null;
  primary_reason: string | null;
  enrichment_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThesisCompany {
  thesis_company_id: string;
  tenant_id: string;
  thesis_id: string;
  company_id: string;
  milestone: string;
  tier: number | null;
  tier_reason: string | null;
  coverage_user_id: string | null;
  added_at: string;
  added_by: string;
  last_milestone_at: string;
  notes: string | null;
}

export interface Task {
  task_id: string;
  tenant_id: string;
  thesis_id: string;
  company_id: string;
  contact_id: string | null;
  task_type: string;
  channel: string | null;
  assigned_user_id: string;
  status: string;
  priority: number | null;
  scheduled_for: string | null;
  completed_at: string | null;
  outcome: string | null;
  outcome_notes: string | null;
  ai_generated: boolean;
  generation_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DialerSession {
  session_id: string;
  tenant_id: string;
  user_id: string;
  thesis_id: string;
  task_filter: Record<string, unknown>;
  retell_call_id: string | null;
  status: string;
  total_calls: number;
  answered_count: number;
  meetings_booked: number;
  started_at: string;
  ended_at: string | null;
}

export interface CallLog {
  call_id: string;
  tenant_id: string;
  session_id: string;
  task_id: string;
  contact_id: string;
  retell_call_id: string | null;
  duration_seconds: number;
  answered: boolean;
  outcome: string;
  transcript: string | null;
  transcript_summary: string | null;
  next_steps: string[];
  sentiment: number;
  recording_gcs_uri: string | null;
  ai_co_pilot_log: unknown;
  created_at: string;
}

export interface EnrichmentRun {
  run_id: string;
  tenant_id: string;
  thesis_id: string | null;
  company_id: string | null;
  scope: string;
  exa_queries: unknown;
  perplexity_calls: number;
  clay_calls: number;
  companies_added: number;
  contacts_added: number;
  cost_usd: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface ThesisDetailResponse extends Thesis {
  counts_by_milestone: Record<string, number>;
  counts_by_tier: Record<string, number>;
  companies: Array<{
    thesis_company: ThesisCompany;
    company: Company;
    primary_contact: CompanyContact | null;
  }>;
}

export interface CompanyDetailResponse {
  company: Company;
  thesis_company: ThesisCompany | null;
  contacts: CompanyContact[];
  recent_calls: CallLog[];
}
