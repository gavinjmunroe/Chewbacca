import { Link } from "react-router-dom";
import { useApi } from "../lib/useApi.js";

export default function ChannelsPage() {
  const { loading, data, error } = useApi("/api/togari/channels");
  if (loading) return <div className="dash-loading">Loading channels...</div>;
  if (error) return <div className="dash-grid__error">{error}</div>;
  return (
    <div>
      <div className="dash-page-head">
        <h1>Channel Explorer</h1>
      </div>
      <div className="dash-cards">
        {data.channels.map((c) => (
          <Link
            key={c.key}
            to={`/dash/channels/${c.key}`}
            className="dash-card"
          >
            <h2>{c.label}</h2>
            <div className="dash-card__stats">
              <span>{c.interactions} interactions</span>
              <span>{c.people} people</span>
              <span>{c.inbound} inbound</span>
            </div>
            <span className="dash-card__foot">
              Last activity:{" "}
              {c.lastActivity
                ? new Date(
                    c.lastActivity.value || c.lastActivity,
                  ).toLocaleDateString()
                : "none yet"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
