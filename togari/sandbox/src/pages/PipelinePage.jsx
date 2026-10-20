import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import { apiFetch } from "../lib/api.js";

export default function PipelinePage() {
  const { loading, data, error, reload } = useApi("/api/togari/pipeline");
  const [moveError, setMoveError] = useState(null);
  const navigate = useNavigate();
  if (loading) return <div className="dash-loading">Loading pipeline...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;

  async function moveTo(stage, payload) {
    const { clientId, name, fromStage } = JSON.parse(payload);
    if (fromStage === stage) return;
    setMoveError(null);
    try {
      await apiFetch(`/api/togari/pipeline/${clientId}`, {
        method: "PATCH",
        body: JSON.stringify({ stage, name }),
      });
      reload();
    } catch (err) {
      setMoveError(err.message);
    }
  }

  return (
    <div>
      <div className="dash-page-head">
        <h1>Pipeline Explorer</h1>
      </div>
      {moveError && (
        <div className="dash-grid__error">Move failed. {moveError}</div>
      )}
      <div className="dash-kanban">
        {data.stages.map((col) => (
          <div
            key={col.stage}
            className="dash-kanban__col"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) =>
              moveTo(col.stage, e.dataTransfer.getData("text/plain"))
            }
          >
            <h2>
              {col.stage} <span>{col.clients.length}</span>
            </h2>
            {col.clients.map((c) => (
              <div
                key={c.client_id}
                className="dash-kanban__card"
                role="button"
                tabIndex={0}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "text/plain",
                    JSON.stringify({
                      clientId: c.client_id,
                      name: c.name,
                      fromStage: col.stage,
                    }),
                  )
                }
                onClick={() => navigate(`/dash/pipeline/${c.client_id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/dash/pipeline/${c.client_id}`);
                  }
                }}
              >
                <strong>{c.name}</strong>
                {c.primary_email && <span>{c.primary_email}</span>}
                {c.owner && (
                  <span className="dash-kanban__owner">{c.owner}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
