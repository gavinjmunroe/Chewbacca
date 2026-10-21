"use client";

import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import Nav from "@/components/nav";
import { DEFAULT_PROFILE, FinancialProfile } from "@/lib/types";

interface FieldProps {
  label: string;
  note?: string;
  children: ReactNode;
}

function Field({ label, note, children }: FieldProps) {
  return (
    <div style={{
      display: "flex", alignItems: "center",
      padding: "12px 0",
      borderBottom: "0.5px solid var(--separator)",
    }}>
      <div style={{ flex: 1 }}>
        <p className="t-subhead" style={{ color: "var(--label)" }}>{label}</p>
        {note && <p className="t-caption2" style={{ color: "var(--label-3)" }}>{note}</p>}
      </div>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, prefix = "$", min = 0, step = 100 }: {
  value: number; onChange: (v: number) => void; prefix?: string; min?: number; step?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {prefix && <span className="t-footnote" style={{ color: "var(--label-3)" }}>{prefix}</span>}
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: 110,
          padding: "6px 10px",
          background: "var(--surface-2)",
          border: "1px solid var(--separator)",
          borderRadius: 8,
          color: "var(--label)",
          fontSize: 14,
          fontFamily: "var(--font)",
          textAlign: "right",
          outline: "none",
        }}
      />
    </div>
  );
}

function PctInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState(() => (value * 100).toFixed(1));
  useEffect(() => { setRaw((value * 100).toFixed(1)); }, [value]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          const n = parseFloat(e.target.value);
          if (!isNaN(n) && n >= 0 && n <= 100) onChange(n / 100);
        }}
        onBlur={() => setRaw((value * 100).toFixed(1))}
        style={{
          width: 72, padding: "6px 10px",
          background: "var(--surface-2)", border: "1px solid var(--separator)",
          borderRadius: 8, color: "var(--label)", fontSize: 14,
          fontFamily: "var(--font)", textAlign: "right", outline: "none",
        }}
      />
      <span className="t-footnote" style={{ color: "var(--label-3)" }}>%</span>
    </div>
  );
}

function GroupHeader({ title }: { title: string }) {
  return <p className="t-caption1" style={{ color: "var(--label-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 0, padding: "20px 0 8px" }}>{title}</p>;
}

function loadProfileLocal(): FinancialProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const s = localStorage.getItem("fiduciary_profile");
    return s ? JSON.parse(s) : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export default function SettingsPage() {
  const [p, setP] = useState<FinancialProfile>(loadProfileLocal);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.profile) {
          setP(data.profile);
          localStorage.setItem("fiduciary_profile", JSON.stringify(data.profile));
        }
      })
      .catch(() => {});
  }, []);

  function update(key: keyof FinancialProfile, val: number) {
    setP((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("fiduciary_profile", JSON.stringify(p));
    }
    try {
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
    } catch {
      // Supabase not configured — localStorage save is sufficient
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "68px 24px 60px", background: "var(--bg)", minHeight: "100dvh" }}>

        <div className="fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
          <div>
            <h1 className="t-large-title" style={{ color: "var(--label)" }}>Settings</h1>
            <p className="t-subhead" style={{ color: "var(--label-3)", marginTop: 4 }}>All values cascade through the projection engine</p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: "9px 20px", borderRadius: 10,
              background: saved ? "var(--green)" : "var(--blue)",
              color: "#fff", border: "none",
              fontSize: 14, fontWeight: 600,
              fontFamily: "var(--font)", cursor: saving ? "default" : "pointer",
              transition: "background 0.3s",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saved ? "Saved ✓" : saving ? "Saving…" : "Save"}
          </button>
        </div>

        <div className="fade-up delay-1">
          <div className="glass" style={{ padding: "4px 20px 4px" }}>
            <GroupHeader title="Personal" />
            <Field label="Current Age" note="Used to calculate projection timeline">
              <NumInput value={p.age} onChange={(v) => update("age", v)} prefix="" step={1} min={16} />
            </Field>
            <Field label="Target Retirement Age" note="When projections end and withdrawal begins">
              <NumInput value={p.retirementAge} onChange={(v) => update("retirementAge", v)} prefix="" step={0.5} min={p.age + 1} />
            </Field>
          </div>

          <div className="glass" style={{ padding: "4px 20px 4px", marginTop: 12 }}>
            <GroupHeader title="Income" />
            <Field label="Base Salary" note="Annual, pre-tax"><NumInput value={p.baseSalary} onChange={(v) => update("baseSalary", v)} step={1000} /></Field>
            <Field label="Bonus" note="Annual"><NumInput value={p.bonus} onChange={(v) => update("bonus", v)} step={1000} /></Field>
            <Field label="RSU Value" note="Current holding value"><NumInput value={p.rsuValue} onChange={(v) => update("rsuValue", v)} step={1000} /></Field>
          </div>

          <div className="glass" style={{ padding: "4px 20px 4px", marginTop: 12 }}>
            <GroupHeader title="Monthly Expenses" />
            <Field label="Rent"><NumInput value={p.rent} onChange={(v) => update("rent", v)} /></Field>
            <Field label="Utilities"><NumInput value={p.utilities} onChange={(v) => update("utilities", v)} step={10} /></Field>
            <Field label="Other Expenses" note="Food, transport, subscriptions…"><NumInput value={p.otherExpenses} onChange={(v) => update("otherExpenses", v)} /></Field>
          </div>

          <div className="glass" style={{ padding: "4px 20px 4px", marginTop: 12 }}>
            <GroupHeader title="Pre-Tax Deductions" />
            <Field label="Health Insurance Premium" note="Monthly, employer-sponsored"><NumInput value={p.healthPremium} onChange={(v) => update("healthPremium", v)} step={10} /></Field>
            <Field label="HSA Contribution" note="Monthly"><NumInput value={p.hsaMonthly} onChange={(v) => update("hsaMonthly", v)} step={10} /></Field>
          </div>

          <div className="glass" style={{ padding: "4px 20px 4px", marginTop: 12 }}>
            <GroupHeader title="Current Balances" />
            <Field label="401(k) Traditional"><NumInput value={p.balance401k} onChange={(v) => update("balance401k", v)} step={1000} /></Field>
            <Field label="Mega Backdoor Roth (Roth 401k)"><NumInput value={p.balanceMegaBackdoor} onChange={(v) => update("balanceMegaBackdoor", v)} step={1000} /></Field>
            <Field label="Roth IRA"><NumInput value={p.balanceRothIRA} onChange={(v) => update("balanceRothIRA", v)} step={1000} /></Field>
            <Field label="Brokerage"><NumInput value={p.balanceBrokerage} onChange={(v) => update("balanceBrokerage", v)} step={1000} /></Field>
            <Field label="HYSA"><NumInput value={p.balanceHYSA} onChange={(v) => update("balanceHYSA", v)} step={500} /></Field>
          </div>

          <div className="glass" style={{ padding: "4px 20px 4px", marginTop: 12 }}>
            <GroupHeader title="Return Assumptions (Nominal)" />
            <Field label="HYSA APY" note="Risk-free savings rate"><PctInput value={p.returnHYSA} onChange={(v) => update("returnHYSA", v)} /></Field>
            <Field label="Brokerage" note="Before tax drag"><PctInput value={p.returnBrokerage} onChange={(v) => update("returnBrokerage", v)} /></Field>
            <Field label="Retirement Accounts (401k + Roth)"><PctInput value={p.returnRetirement} onChange={(v) => update("returnRetirement", v)} /></Field>
            <Field label="RSU Growth"><PctInput value={p.returnRSU} onChange={(v) => update("returnRSU", v)} /></Field>
            <Field label="Brokerage Tax Drag"><PctInput value={p.brokerageTaxDrag} onChange={(v) => update("brokerageTaxDrag", v)} /></Field>
            <Field label="Inflation"><PctInput value={p.inflation} onChange={(v) => update("inflation", v)} /></Field>
          </div>

          <div className="glass" style={{ padding: "4px 20px 4px", marginTop: 12 }}>
            <GroupHeader title="Retirement Assumptions" />
            <Field label="Assumed Marginal Rate at Retirement" note="Applied to pre-tax 401(k) withdrawals"><PctInput value={p.retirementMarginalRate} onChange={(v) => update("retirementMarginalRate", v)} /></Field>
            <Field label="Emergency Fund Target"><NumInput value={p.emergencyFundTarget} onChange={(v) => update("emergencyFundTarget", v)} step={1000} /></Field>
          </div>

          <div className="glass" style={{ padding: "4px 20px 4px", marginTop: 12 }}>
            <GroupHeader title="Salary Growth" />
            <Field label="Annual Raise Rate"><PctInput value={p.annualRaiseRate} onChange={(v) => update("annualRaiseRate", v)} /></Field>
            <Field label="Promotion Every N Years"><NumInput value={p.promotionEveryYears} onChange={(v) => update("promotionEveryYears", v)} prefix="" step={1} min={1} /></Field>
            <Field label="Promotion Salary Bump"><PctInput value={p.promotionBump} onChange={(v) => update("promotionBump", v)} /></Field>
          </div>

          <div style={{ marginTop: 24, padding: "14px 0" }}>
            <p className="t-caption2" style={{ color: "var(--label-4)", lineHeight: 1.6 }}>
              This tool is for personal financial modeling only and does not constitute financial, tax, or legal advice. Tax brackets and contribution limits reflect 2026 IRS and CA FTB published schedules. Projections are illustrative — actual results will vary based on market performance, law changes, and personal circumstances.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
