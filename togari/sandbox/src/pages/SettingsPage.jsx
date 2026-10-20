import { useState } from "react";
import { useApi } from "../lib/useApi.js";
import { apiFetch } from "../lib/api.js";

function StatusPill({ on }) {
  return (
    <span
      className={
        "dash-settings__pill" +
        (on ? " dash-settings__pill--on" : " dash-settings__pill--off")
      }
    >
      {on ? "Connected" : "Not connected"}
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString();
}

export default function SettingsPage() {
  const { loading, data, error, reload } = useApi("/api/togari/settings");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState("");

  if (loading) return <div className="dash-loading">Loading settings...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;

  const { brand, bigquery, mcp, wikiDb, channels, keys } = data;

  async function createKey(e) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setActionError("");
    setCopied(false);
    try {
      const created = await apiFetch("/api/togari/settings/keys", {
        method: "POST",
        body: JSON.stringify({ label: trimmed }),
      });
      setRevealed(created);
      setLabel("");
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id, keyLabel) {
    if (
      !window.confirm(`Revoke "${keyLabel}"? Anything using it stops working.`)
    )
      return;
    setActionError("");
    try {
      await apiFetch(`/api/togari/settings/keys/${id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function copyKey() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="dash-page-head">
        <h1>Settings</h1>
        <span className="dash-page-head__meta">
          Connection status and personal API keys.
        </span>
      </div>

      {actionError && <div className="dash-grid__error">{actionError}</div>}

      <h2 className="dash-settings__heading">Connections</h2>
      <div className="dash-settings__grid">
        <div className="dash-settings__conn">
          <span className="dash-settings__conn-label">Brand</span>
          <span className="dash-settings__conn-value">
            {String(brand).toUpperCase()}
          </span>
          <span className="dash-settings__channels">
            Channels: {channels.join(", ")}
          </span>
        </div>
        <div className="dash-settings__conn">
          <span className="dash-settings__conn-label">BigQuery</span>
          <StatusPill on={bigquery} />
        </div>
        <div className="dash-settings__conn">
          <span className="dash-settings__conn-label">Togari MCP</span>
          <StatusPill on={mcp} />
        </div>
        <div className="dash-settings__conn">
          <span className="dash-settings__conn-label">Wiki database</span>
          <StatusPill on={wikiDb} />
        </div>
      </div>

      <h2 className="dash-settings__heading">API keys</h2>
      <p className="dash-settings__intro">
        Keys act as your login for scripts and integrations. Anyone holding a
        key can read and write Togari data as you.
      </p>

      {revealed && (
        <div className="dash-settings__reveal">
          <span className="dash-settings__reveal-label">
            New key: {revealed.label}
          </span>
          <code className="dash-settings__reveal-key">{revealed.key}</code>
          <div className="dash-settings__reveal-actions">
            <button type="button" className="dash-btn" onClick={copyKey}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="dash-btn"
              onClick={() => {
                setRevealed(null);
                setCopied(false);
              }}
            >
              Dismiss
            </button>
          </div>
          <span className="dash-settings__reveal-warn">
            Copy it now. You will not see this key again.
          </span>
        </div>
      )}

      {wikiDb ? (
        <form className="dash-settings__create" onSubmit={createKey}>
          <input
            className="dash-settings__input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Key label, e.g. Zapier"
            aria-label="Key label"
          />
          <button
            type="submit"
            className="dash-btn"
            disabled={creating || !label.trim()}
          >
            {creating ? "Creating..." : "Create key"}
          </button>
        </form>
      ) : (
        <p className="dash-settings__notice">
          API keys need the wiki database, which is not connected.
        </p>
      )}

      {keys.length === 0 ? (
        <p className="dash-settings__empty">No keys yet.</p>
      ) : (
        <table className="dash-grid__table dash-settings__table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Key</th>
              <th>Created</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.label}</td>
                <td>
                  <code className="dash-settings__prefix">{k.prefix}...</code>
                </td>
                <td>{formatDate(k.createdAt)}</td>
                <td>{k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never"}</td>
                <td>
                  <button
                    type="button"
                    className="dash-btn"
                    onClick={() => revokeKey(k.id, k.label)}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
