// src/pages/PersonDrillPage.jsx
import { useParams } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import DrillDown from "../components/togari/DrillDown.jsx";
import DataGrid from "../components/togari/DataGrid.jsx";
import MiniBarChart from "../components/togari/MiniBarChart.jsx";

const INTERACTION_COLUMNS = [
  { key: "channel", label: "Channel" },
  { key: "direction", label: "Direction" },
  { key: "subject", label: "Subject" },
  { key: "summary", label: "Summary" },
  {
    key: "occurred_at",
    label: "When",
    render: (r) =>
      r.occurred_at
        ? new Date(r.occurred_at.value || r.occurred_at).toLocaleDateString()
        : "-",
  },
];

export default function PersonDrillPage() {
  const { personId } = useParams();
  const { loading, data, error } = useApi(`/api/togari/people/${personId}`);
  if (loading) return <div className="dash-loading">Loading person...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;
  const { entity, related, analytics } = data;
  return (
    <DrillDown
      title={entity.full_name || "Unknown"}
      subtitle={[entity.title, entity.company].filter(Boolean).join(" at ")}
      backTo="/dash/data"
      stats={[
        { label: "Relationship score", value: entity.relationship_score },
        { label: "Interactions", value: entity.interaction_count },
        {
          label: "Avg sentiment",
          value:
            analytics.avgSentiment == null
              ? "-"
              : analytics.avgSentiment.toFixed(2),
        },
        {
          label: "Top channel",
          value:
            Object.entries(analytics.byChannel).sort(
              (a, b) => b[1] - a[1],
            )[0]?.[0] || "-",
        },
      ]}
    >
      <section className="dash-section">
        <h2>Activity, last 12 months</h2>
        <MiniBarChart data={analytics.monthly} xKey="month" yKey="count" />
      </section>
      <section className="dash-section">
        <h2>Recent interactions</h2>
        <DataGrid
          columns={INTERACTION_COLUMNS}
          rows={related.interactions}
          rowKey="interaction_id"
          emptyLabel="No interactions recorded"
        />
      </section>
    </DrillDown>
  );
}
