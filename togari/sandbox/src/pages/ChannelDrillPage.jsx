import { useNavigate, useParams } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import DrillDown from "../components/togari/DrillDown.jsx";
import DataGrid from "../components/togari/DataGrid.jsx";
import MiniBarChart from "../components/togari/MiniBarChart.jsx";

const PEOPLE_COLUMNS = [
  { key: "full_name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "total", label: "Touches" },
  { key: "inbound", label: "Replies / inbound" },
];

export default function ChannelDrillPage() {
  const { key } = useParams();
  const navigate = useNavigate();
  const { loading, data, error } = useApi(`/api/togari/channels/${key}`);
  if (loading) return <div className="dash-loading">Loading channel...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;
  const { entity, related, analytics } = data;
  const replyRate = analytics.totals.count
    ? Math.round((analytics.totals.inbound / analytics.totals.count) * 100)
    : 0;
  return (
    <DrillDown
      title={entity.label}
      subtitle="Last 12 weeks"
      backTo="/dash/channels"
      stats={[
        { label: "Interactions", value: analytics.totals.count },
        { label: "Inbound", value: analytics.totals.inbound },
        { label: "Reply rate", value: `${replyRate}%` },
      ]}
    >
      <section className="dash-section">
        <h2>Weekly volume</h2>
        <MiniBarChart data={analytics.weekly} xKey="week" yKey="count" />
      </section>
      <section className="dash-section">
        <h2>Who is reacting, last 12 weeks</h2>
        <DataGrid
          columns={PEOPLE_COLUMNS}
          rows={related.topPeople}
          rowKey="person_id"
          emptyLabel="No engagement yet on this channel"
          onRowClick={(row) => navigate(`/dash/data/person/${row.person_id}`)}
        />
      </section>
    </DrillDown>
  );
}
