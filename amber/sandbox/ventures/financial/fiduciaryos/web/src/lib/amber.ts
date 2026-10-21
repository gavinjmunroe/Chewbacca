/**
 * Amber Integration — FiduciaryOS
 *
 * Pushes financial health signals to Amber whenever meaningful events occur:
 *   - Portfolio snapshot (net worth, allocation, performance)
 *   - Tax event (estimated liability, deductions, refund)
 *   - Cash flow update (income vs. spend, savings rate)
 *   - Goal milestone (retirement, home, emergency fund)
 *
 * Amber maps FiduciaryOS → "financial" health dimension (0–100 score).
 *
 * Usage:
 *   import { pushAmberSignal } from '@/lib/amber'
 *   await pushAmberSignal(amberUserId, { type: 'portfolio_snapshot', ... })
 */

const AMBER_API_URL = process.env.AMBER_API_URL ?? 'https://api.amber.health';
const AMBER_WEBHOOK_SECRET = process.env.AMBER_WEBHOOK_SECRET;

export type PortfolioSignal = {
  type: 'portfolio_snapshot';
  netWorth: number;
  liquidAssets: number;
  investedAssets: number;
  totalDebt: number;
  allocationEquity: number;
  allocationBonds: number;
  allocationCash: number;
  monthlyReturn?: number;
  ytdReturn?: number;
};

export type TaxSignal = {
  type: 'tax_event';
  estimatedLiability: number;
  effectiveRate: number;
  deductionsFound: number;
  deductionValue: number;
  taxYear: number;
  refundOrOwed: number;
};

export type CashFlowSignal = {
  type: 'cash_flow';
  monthlyIncome: number;
  monthlyExpenses: number;
  savingsRate: number;
  emergencyFundMonths: number;
};

export type GoalSignal = {
  type: 'goal_milestone';
  goalName: string;
  targetAmount: number;
  currentAmount: number;
  percentComplete: number;
  onTrack: boolean;
};

export type AmberFinancialSignal =
  | PortfolioSignal
  | TaxSignal
  | CashFlowSignal
  | GoalSignal;

/**
 * Push a financial signal to Amber for the given Amber user ID.
 * Non-blocking — errors are logged but never thrown.
 */
export async function pushAmberSignal(
  amberUserId: string | number,
  signal: AmberFinancialSignal
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Amber-User-Id': String(amberUserId),
    };
    if (AMBER_WEBHOOK_SECRET) {
      headers['X-Amber-Webhook-Secret'] = AMBER_WEBHOOK_SECRET;
    }

    const res = await fetch(`${AMBER_API_URL}/integrations/fiduciaryos/signal`, {
      method: 'POST',
      headers,
      body: JSON.stringify(signal),
    });

    if (!res.ok) {
      console.warn('[amber] signal push failed:', res.status, await res.text());
    }
  } catch (err) {
    console.warn('[amber] signal push error:', err);
  }
}
