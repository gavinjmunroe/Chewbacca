import { RiskLevel, RISK_LEVEL_LABELS, RISK_LEVEL_COLORS } from "@/lib/unified-types";

interface Props {
  riskLevel: RiskLevel;
  alerts: string[];
  offline?: boolean;
}

const LEVEL_DESCRIPTIONS: Record<RiskLevel, string> = {
  0: "All systems nominal. Portfolio within policy bounds.",
  1: "Minor drift detected. Monitoring initiated.",
  2: "Drawdown or concentration threshold breached. Review recommended.",
  3: "Safe Mode active. All trading halted. Positions moving to cash.",
  4: "Emergency halt. Manual intervention required.",
};

export default function RiskGuardianPanel({ riskLevel, alerts, offline }: Props) {
  const color = offline ? "var(--label-3)" : RISK_LEVEL_COLORS[riskLevel];
  const label = offline ? "OFFLINE" : RISK_LEVEL_LABELS[riskLevel];

  return (
    <div className="glass" style={{ padding: "20px" }}>
      <h2 className="t-headline" style={{ color: "var(--label)", marginBottom: 16 }}>Risk Guardian</h2>

      {/* Level indicator */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", borderRadius: 12,
        background: `${color}10`,
        border: `1px solid ${color}30`,
        marginBottom: 14,
      }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <div>
          <p className="t-headline" style={{ color }}>{label}</p>
          <p className="t-caption2" style={{ color: "var(--label-3)", marginTop: 2 }}>
            {offline ? "Python backend not running" : LEVEL_DESCRIPTIONS[riskLevel]}
          </p>
        </div>
      </div>

      {/* Level scale */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {([0, 1, 2, 3, 4] as RiskLevel[]).map((lvl) => (
          <div
            key={lvl}
            style={{
              flex: 1, height: 4, borderRadius: 2,
              background: !offline && lvl <= riskLevel ? RISK_LEVEL_COLORS[lvl] : "var(--surface-2)",
              transition: "background 0.3s",
            }}
          />
        ))}
      </div>

      {/* Active alerts */}
      {alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {alerts.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ width: 4, height: 4, borderRadius: "50%", background: color, marginTop: 5, flexShrink: 0 }} />
              <p className="t-caption1" style={{ color: "var(--label-3)" }}>{a}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
