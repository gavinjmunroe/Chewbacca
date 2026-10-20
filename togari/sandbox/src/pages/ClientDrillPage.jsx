import { useLocation, useParams } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import DrillDown from "../components/togari/DrillDown.jsx";
import DataGrid from "../components/togari/DataGrid.jsx";

const TASK_COLUMNS = [
  { key: "description", label: "Task" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
  {
    key: "due_date",
    label: "Due",
    render: (r) => {
      const due = r.due_date?.value || r.due_date;
      return due ? new Date(due).toLocaleDateString() : "-";
    },
  },
  { key: "priority", label: "Priority" },
];

const CONTEXT_COLUMNS = [
  { key: "title", label: "Title" },
  { key: "content_type", label: "Type" },
  { key: "source", label: "Source" },
  {
    key: "occurred_at",
    label: "When",
    render: (r) => {
      const ts = r.occurred_at || r.created_at;
      return ts ? new Date(ts.value || ts).toLocaleDateString() : "-";
    },
  },
];

export default function ClientDrillPage() {
  const { clientId } = useParams();
  const location = useLocation();
  const backTo = location.pathname.startsWith("/dash/clients")
    ? "/dash/clients"
    : "/dash/pipeline";
  const { loading, data, error } = useApi(`/api/togari/clients/${clientId}`);
  if (loading) return <div className="dash-loading">Loading client...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;
  const { entity, related, analytics } = data;
  return (
    <DrillDown
      title={entity.name}
      subtitle={[entity.stage, entity.owner, entity.primary_email]
        .filter(Boolean)
        .join("  |  ")}
      backTo={backTo}
      stats={[
        { label: "Open tasks", value: analytics.openTasks },
        { label: "Done tasks", value: analytics.doneTasks },
        {
          label: "Last touch",
          value: analytics.lastTouch
            ? new Date(
                analytics.lastTouch.value || analytics.lastTouch,
              ).toLocaleDateString()
            : "-",
        },
        { label: "Context items", value: related.context.length },
      ]}
    >
      {entity.summary && (
        <section className="dash-section">
          <h2>Summary</h2>
          <p>{entity.summary}</p>
        </section>
      )}
      <section className="dash-section">
        <h2>Tasks</h2>
        <DataGrid
          columns={TASK_COLUMNS}
          rows={related.tasks}
          rowKey="task_id"
          emptyLabel="No tasks"
        />
      </section>
      <section className="dash-section">
        <h2>Context timeline</h2>
        <DataGrid
          columns={CONTEXT_COLUMNS}
          rows={related.context}
          rowKey="context_id"
          emptyLabel="No context yet"
        />
      </section>
    </DrillDown>
  );
}
