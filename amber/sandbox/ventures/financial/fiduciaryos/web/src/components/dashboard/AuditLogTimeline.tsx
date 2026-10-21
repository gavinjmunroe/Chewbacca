import { AuditEntry, RISK_LEVEL_COLORS } from "@/lib/unified-types";

interface Props {
  entries: AuditEntry[];
  offline?: boolean;
}

export default function AuditLogTimeline({ entries, offline }: Props) {
  return (
    <div className="glass" style={{ padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 className="t-headline" style={{ color: "var(--label)" }}>Audit Log</h2>
        <span className="t-footnote" style={{ color: "var(--label-3)" }}>Cryptographically signed · replayable</span>
      </div>

      {offline ? (
        <p className="t-footnote" style={{ color: "var(--label-3)" }}>Python backend offline. Audit log is unavailable until the server is running.</p>
      ) : entries.length === 0 ? (
        <p className="t-footnote" style={{ color: "var(--label-3)" }}>No audit entries yet. Portfolio actions will appear here.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {entries.map((entry, i) => {
            const ts = new Date(entry.timestamp_iso);
            const color = RISK_LEVEL_COLORS[entry.risk_level];
            return (
              <div
                key={entry.id}
                style={{
                  display: "flex", gap: 12, alignItems: "flex-start",
                  padding: "12px 0",
                  borderBottom: i < entries.length - 1 ? "0.5px solid var(--separator)" : "none",
                }}
              >
                {/* Timeline dot */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  {i < entries.length - 1 && <div style={{ width: 1, flex: 1, background: "var(--separator)", marginTop: 4 }} />}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <p className="t-footnote" style={{ color: "var(--label)", fontWeight: 500 }}>{entry.action_type}</p>
                    <span
                      className="t-caption2"
                      style={{
                        padding: "1px 6px", borderRadius: 4,
                        background: entry.policy_check_passed ? "rgba(48,209,88,0.12)" : "rgba(255,69,58,0.12)",
                        color: entry.policy_check_passed ? "var(--green)" : "var(--red)",
                      }}
                    >
                      {entry.policy_check_passed ? "Policy ✓" : "Policy ✗"}
                    </span>
                  </div>
                  {entry.model_reasoning && (
                    <p className="t-caption2" style={{ color: "var(--label-3)", marginBottom: 4, lineHeight: 1.5 }}>
                      {entry.model_reasoning.slice(0, 120)}{entry.model_reasoning.length > 120 ? "…" : ""}
                    </p>
                  )}
                  <p className="t-caption2" style={{ color: "var(--label-4)", fontFamily: "monospace" }}>
                    {ts.toLocaleString()} · sig: {entry.signature.slice(0, 16)}…
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
