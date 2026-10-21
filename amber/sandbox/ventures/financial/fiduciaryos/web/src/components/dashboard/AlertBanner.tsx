import { AppAlert } from "@/lib/types";
import { MergedAlert } from "@/lib/unified-types";

type AnyAlert = AppAlert | MergedAlert;

interface Props { alerts: AnyAlert[] }

const COLORS: Record<string, string> = {
  info: "var(--blue)",
  warning: "var(--orange)",
  critical: "var(--red)",
};

export default function AlertBanner({ alerts }: Props) {
  if (!alerts.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {alerts.map((a, idx) => (
        <div
          key={idx}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: `${COLORS[a.severity]}12`,
            border: `1px solid ${COLORS[a.severity]}30`,
            display: "flex", gap: 10, alignItems: "flex-start",
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS[a.severity], marginTop: 5, flexShrink: 0 }} />
          <p className="t-footnote" style={{ color: "var(--label-2)", lineHeight: 1.5 }}>{a.message}</p>
        </div>
      ))}
    </div>
  );
}
