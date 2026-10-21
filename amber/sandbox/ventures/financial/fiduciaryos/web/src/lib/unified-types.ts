import { FinancialProfile } from "./types";

// Bridges Francesca's FinancialProfile ↔ FiduciaryOS's ClientProfile
export interface UnifiedClientProfile extends FinancialProfile {
  // FiduciaryOS-specific additions
  clientId: string;
  riskTolerance: "conservative" | "moderate" | "aggressive";
  timeHorizonYears: number;
  targetAllocation: {
    us_equity: number;
    international_equity: number;
    us_bonds: number;
    international_bonds: number;
    alternatives: number;
    cash: number;
  };
  rebalancingBands: { equities: number; bonds: number; cash: number };
  excludedSectors: string[];
  excludedSecurities: string[];
  maxSingleSecurityPct: number;
  liquidityReserveMonths: number;
  alphaSleeveEnabled: boolean;
  alphaSleeveMaxPct: number;

  // Plaid-synced live balances (override static profile balances when present)
  plaidSyncedAt?: string;

  // Computed at profile load time from projection
  derivedInvestableAssets?: number; // sum of all account balances
}

export const DEFAULT_UNIFIED_PROFILE: Partial<UnifiedClientProfile> = {
  clientId: "default",
  riskTolerance: "moderate",
  timeHorizonYears: 37,
  targetAllocation: {
    us_equity: 0.50,
    international_equity: 0.20,
    us_bonds: 0.20,
    international_bonds: 0.05,
    alternatives: 0.03,
    cash: 0.02,
  },
  rebalancingBands: { equities: 0.05, bonds: 0.03, cash: 0.02 },
  excludedSectors: [],
  excludedSecurities: [],
  maxSingleSecurityPct: 0.10,
  liquidityReserveMonths: 6,
  alphaSleeveEnabled: false,
  alphaSleeveMaxPct: 0.05,
};

// Derives the Python ClientProfile shape from UnifiedClientProfile
export function toClientProfile(u: UnifiedClientProfile) {
  const investableAssets =
    u.derivedInvestableAssets ??
    (u.balance401k + u.balanceMegaBackdoor + u.balanceRothIRA + u.balanceBrokerage + u.balanceHYSA);

  return {
    client_id: u.clientId,
    risk_tolerance: u.riskTolerance,
    time_horizon_years: u.timeHorizonYears,
    annual_income: u.baseSalary + u.bonus,
    investable_assets: investableAssets,
    target_allocation: u.targetAllocation,
    rebalancing_bands: u.rebalancingBands,
    max_drawdown_tolerance: { conservative: 0.10, moderate: 0.18, aggressive: 0.30 }[u.riskTolerance],
    volatility_target: { conservative: 0.06, moderate: 0.10, aggressive: 0.16 }[u.riskTolerance],
    excluded_sectors: u.excludedSectors,
    excluded_securities: u.excludedSecurities,
    max_single_security_pct: u.maxSingleSecurityPct,
    liquidity_reserve_months: u.liquidityReserveMonths,
    alpha_sleeve_enabled: u.alphaSleeveEnabled,
    alpha_sleeve_max_pct: u.alphaSleeveMaxPct,
  };
}

// Risk level types from FiduciaryOS Risk Guardian
export type RiskLevel = 0 | 1 | 2 | 3 | 4;
export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  0: "SAFE",
  1: "MONITORING",
  2: "ALERT",
  3: "SAFE MODE",
  4: "HALT",
};
export const RISK_LEVEL_COLORS: Record<RiskLevel, string> = {
  0: "var(--green)",
  1: "var(--blue)",
  2: "var(--orange)",
  3: "var(--red)",
  4: "var(--red)",
};

export interface PortfolioStateRequest {
  client_id: string;
  total_value_usd: number;
  holdings: Record<string, number>;
  allocation: Record<string, number>;
  unrealized_pnl_usd: number;
  drawdown_from_peak: number;
  daily_volatility: number;
  cash_usd: number;
}

export interface TaxHarvestCandidate {
  ticker: string;
  unrealized_loss_usd: number;
  tax_savings_estimate_usd: number;
  wash_sale_safe: boolean;
  replacement_tickers: string[];
  net_benefit_usd: number;
}

export interface AuditEntry {
  id: string;
  timestamp_iso: string;
  client_id_hash: string;
  action_type: string;
  action_details: Record<string, unknown>;
  policy_check_passed: boolean;
  risk_level: RiskLevel;
  model_reasoning: string;
  signature: string;
}

export interface MergedAlert {
  source: "forecast" | "risk_guardian";
  severity: "info" | "warning" | "critical";
  message: string;
  level?: RiskLevel;
}
