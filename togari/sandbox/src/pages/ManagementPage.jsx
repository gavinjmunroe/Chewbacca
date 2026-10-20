import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import { apiFetch } from "../lib/api.js";

function ClientCard({ client, onSaved }) {
  const [slackUrl, setSlackUrl] = useState(client.attributes.slack_url || "");
  const [contractUrl, setContractUrl] = useState(
    client.attributes.contract_url || "",
  );
  const [status, setStatus] = useState("");

  async function saveMeta(e) {
    e.preventDefault();
    setStatus("Saving...");
    try {
      await apiFetch(`/api/togari/management/${client.client_id}/meta`, {
        method: "POST",
        body: JSON.stringify({
          name: client.name,
          slack_url: slackUrl,
          contract_url: contractUrl,
        }),
      });
      setStatus("Saved");
      onSaved();
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function uploadDnc(e) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setStatus("Uploading DNC list...");
    try {
      const content = await file.text();
      await apiFetch(`/api/togari/management/${client.client_id}/dnc`, {
        method: "POST",
        body: JSON.stringify({
          name: client.name,
          filename: file.name,
          content,
        }),
      });
      setStatus(`Stored ${file.name}`);
    } catch (err) {
      setStatus(err.message);
    } finally {
      input.value = "";
    }
  }

  const tasks = client.tasks || [];
  const overdueCount = tasks.filter((t) => t.overdue).length;

  return (
    <div className="dash-card dash-card--static">
      <Link
        to={`/dash/clients/${client.client_id}`}
        className="dash-card__title"
      >
        <h2>{client.name}</h2>
      </Link>
      <div className="dash-card__stats">
        {client.stage && (
          <span className="dash-pill dash-pill--muted">{client.stage}</span>
        )}
        {client.owner && <span>Owner: {client.owner}</span>}
        {client.attributes.slack_url && (
          <a
            href={client.attributes.slack_url}
            target="_blank"
            rel="noreferrer"
          >
            Slack
          </a>
        )}
        {client.attributes.contract_url && (
          <a
            href={client.attributes.contract_url}
            target="_blank"
            rel="noreferrer"
          >
            Contract
          </a>
        )}
      </div>
      <div className="dash-tasks">
        <h3 className="dash-tasks__head">
          Open work ({tasks.length})
          {overdueCount > 0 && (
            <span className="dash-tasks__overdue-count">
              {overdueCount} overdue
            </span>
          )}
        </h3>
        {tasks.length === 0 ? (
          <p className="dash-tasks__empty">Nothing open. All caught up.</p>
        ) : (
          <ul className="dash-task-list">
            {tasks.map((t) => (
              <li
                key={t.task_id}
                className={`dash-task${t.overdue ? " dash-task--overdue" : ""}`}
              >
                <span className="dash-task__desc">{t.description}</span>
                <span className="dash-task__due">
                  {t.due_date
                    ? (t.overdue ? "was due " : "due ") + t.due_date
                    : "no due date"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form className="dash-card__form" onSubmit={saveMeta}>
        <input
          value={slackUrl}
          onChange={(e) => setSlackUrl(e.target.value)}
          placeholder="Slack channel URL"
        />
        <input
          value={contractUrl}
          onChange={(e) => setContractUrl(e.target.value)}
          placeholder="Contract URL"
        />
        <div className="dash-card__actions">
          <button type="submit" className="dash-btn">
            Save
          </button>
          <label className="dash-btn">
            Upload DNC list
            <input
              type="file"
              accept=".csv,.txt"
              className="dash-visually-hidden"
              onChange={uploadDnc}
            />
          </label>
        </div>
      </form>
      {status && <span className="dash-card__foot">{status}</span>}
    </div>
  );
}

export default function ManagementPage() {
  const [scope, setScope] = useState("paying");
  const { loading, data, error, reload } = useApi(
    `/api/togari/management?scope=${scope}`,
  );
  if (loading) return <div className="dash-loading">Loading clients...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;
  const label = scope === "paying" ? "paying clients" : "active accounts";
  // Accounts needing attention first: most overdue, then most open work.
  const clients = [...data.clients].sort((a, b) => {
    const ov = (c) => (c.tasks || []).filter((t) => t.overdue).length;
    return ov(b) - ov(a) || (b.tasks?.length || 0) - (a.tasks?.length || 0);
  });
  return (
    <div>
      <div className="dash-page-head">
        <h1>Management Explorer</h1>
        <span className="dash-page-head__meta">
          {data.clients.length} {label}
        </span>
      </div>
      <div className="dash-seg" role="tablist" aria-label="Account scope">
        <button
          className={`dash-seg__btn${scope === "paying" ? " dash-seg__btn--active" : ""}`}
          role="tab"
          aria-selected={scope === "paying"}
          onClick={() => setScope("paying")}
        >
          Paying clients
        </button>
        <button
          className={`dash-seg__btn${scope === "all" ? " dash-seg__btn--active" : ""}`}
          role="tab"
          aria-selected={scope === "all"}
          onClick={() => setScope("all")}
        >
          All active accounts
        </button>
      </div>
      <div className="dash-cards">
        {data.clients.length === 0 && (
          <p className="dash-placeholder">
            {scope === "paying"
              ? "No paying clients yet. A client appears here once their status is won."
              : "No active accounts yet."}
          </p>
        )}
        {clients.map((c) => (
          <ClientCard key={c.client_id} client={c} onSaved={reload} />
        ))}
      </div>
    </div>
  );
}
