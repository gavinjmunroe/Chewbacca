import { createClient } from "@supabase/supabase-js";
import { env } from "../env.js";
import type {
  NewReimbursement,
  Reimbursement,
  ReimbursementStatus,
} from "./types.js";

const TABLE = "reimbursements";

export const supabase = createClient(
  env.supabase.url,
  env.supabase.serviceRoleKey,
  {
    auth: { persistSession: false },
  },
);

export async function createReimbursement(
  input: NewReimbursement,
): Promise<Reimbursement> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...input, status: "pending" satisfies ReimbursementStatus })
    .select("*")
    .single();
  if (error) throw new Error(`createReimbursement failed: ${error.message}`);
  return data as Reimbursement;
}

export async function getReimbursement(
  id: string,
): Promise<Reimbursement | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getReimbursement failed: ${error.message}`);
  return (data as Reimbursement) ?? null;
}

/**
 * Atomically move a request out of `pending`. The `.eq("status", "pending")` guard makes
 * approve/reject idempotent: a second tap finds no matching row and returns null, so we
 * never double-approve or double-pay. Returns the updated row, or null if it was not
 * pending anymore.
 */
export async function transitionFromPending(
  id: string,
  patch: Partial<Reimbursement> & { status: ReimbursementStatus },
): Promise<Reimbursement | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`transitionFromPending failed: ${error.message}`);
  return (data as Reimbursement) ?? null;
}

/** Same idempotent guard, for the approved -> paid step. */
export async function markPaid(id: string): Promise<Reimbursement | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "approved")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`markPaid failed: ${error.message}`);
  return (data as Reimbursement) ?? null;
}

export async function setSheetRow(id: string, row: number): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ sheet_row: row })
    .eq("id", id);
  if (error) throw new Error(`setSheetRow failed: ${error.message}`);
}
