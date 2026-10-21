interface Props {
  compiled: boolean;
  expiresAt?: string;
  riskTolerance?: string;
  offline?: boolean;
}

export default function PolicyArtifactCard({ compiled, expiresAt, riskTolerance, offline }: Props) {
  const statusColor = offline ? "var(--label-3)" : compiled ? "var(--green)" : "var(--orange)";
  const statusLabel = offline ? "Offline" : compiled ? "Active" : "Not Compiled";

  return (
    <div className="glass" style={{ padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 className="t-headline" style={{ color: "var(--label)" }}>Policy Artifact</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
          <span className="t-footnote" style={{ color: statusColor }}>{statusLabel}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "0.5px solid var(--separator)" }}>
          <p className="t-footnote" style={{ color: "var(--label-3)" }}>Signature</p>
          <p className="t-footnote" style={{ color: "var(--label-2)", fontFamily: "monospace" }}>
            {compiled && !offline ? "RSA-4096 ✓" : "—"}
          </p>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "0.5px solid var(--separator)" }}>
          <p className="t-footnote" style={{ color: "var(--label-3)" }}>Risk Tolerance</p>
          <p className="t-footnote" style={{ color: "var(--label-2)" }}>{riskTolerance ?? "—"}</p>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
          <p className="t-footnote" style={{ color: "var(--label-3)" }}>Expires</p>
          <p className="t-footnote" style={{ color: "var(--label-2)" }}>
            {expiresAt ? new Date(expiresAt).toLocaleDateString() : "—"}
          </p>
        </div>
      </div>

      {!compiled && !offline && (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(255,159,10,0.08)", border: "1px solid rgba(255,159,10,0.25)" }}>
          <p className="t-caption1" style={{ color: "var(--orange)" }}>
            Complete onboarding to compile your signed policy artifact. All portfolio actions require an active policy.
          </p>
        </div>
      )}

      {offline && (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(84,84,88,0.2)", border: "1px solid var(--separator)" }}>
          <p className="t-caption1" style={{ color: "var(--label-3)" }}>
            Python backend offline. Start the FastAPI server to enable policy enforcement.
          </p>
        </div>
      )}
    </div>
  );
}
