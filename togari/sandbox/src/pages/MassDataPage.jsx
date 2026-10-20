// src/pages/MassDataPage.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../lib/useApi.js";
import { apiFetch } from "../lib/api.js";
import DataGrid from "../components/togari/DataGrid.jsx";
import ChatPanel from "../components/togari/ChatPanel.jsx";

const PEOPLE_COLUMNS = [
  { key: "full_name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email" },
  { key: "relationship_score", label: "Score" },
  { key: "interaction_count", label: "Interactions" },
  {
    key: "last_interaction_at",
    label: "Last touch",
    render: (r) =>
      r.last_interaction_at
        ? new Date(
            r.last_interaction_at.value || r.last_interaction_at,
          ).toLocaleDateString()
        : "-",
  },
];

// "Researching" is STAGE_ORDER[0] in server/togari/pipeline.js: the first
// column of the live kanban a promoted company lands in.
const FIRST_PIPELINE_STAGE = "Researching";

const TABS = {
  people: {
    endpoint: "people",
    rowKey: "person_id",
    countLabel: "people",
    emptyLabel:
      "No people yet. Run a refresh to pull from Gmail, Fireflies, and Calendar.",
  },
  companies: {
    endpoint: "companies",
    rowKey: "client_id",
    countLabel: "companies",
    emptyLabel: "No companies yet. Run a refresh to pull from your pipeline.",
  },
};

export default function MassDataPage() {
  const [tab, setTab] = useState("people");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  // Local promote-to-pipeline state so a promoted row updates in place with no
  // full reload: promotingIds are in flight, promotedStages override a row's
  // stage by client_id once the PATCH succeeds.
  const [promotingIds, setPromotingIds] = useState(() => new Set());
  const [promotedStages, setPromotedStages] = useState({});
  const [promoteError, setPromoteError] = useState(null);
  const navigate = useNavigate();
  const active = TABS[tab];
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const path = useMemo(
    () =>
      `/api/togari/${active.endpoint}?search=${encodeURIComponent(
        debouncedSearch,
      )}&limit=200`,
    [active.endpoint, debouncedSearch],
  );
  const { loading, data, error, reload } = useApi(path);

  const promote = useCallback(async (company) => {
    const id = company.client_id;
    setPromoteError(null);
    setPromotingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      const result = await apiFetch(`/api/togari/pipeline/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: company.name,
          stage: FIRST_PIPELINE_STAGE,
        }),
      });
      setPromotedStages((prev) => ({
        ...prev,
        [id]: result?.stage || FIRST_PIPELINE_STAGE,
      }));
    } catch (err) {
      setPromoteError(err.message);
    } finally {
      setPromotingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const companyColumns = useMemo(
    () => [
      { key: "name", label: "Name" },
      {
        key: "stage",
        label: "Stage",
        render: (row) => {
          const stage = promotedStages[row.client_id] || row.stage;
          if (stage) {
            return <span className="dash-pill dash-pill--muted">{stage}</span>;
          }
          const inFlight = promotingIds.has(row.client_id);
          return (
            <button
              type="button"
              className="dash-row-action"
              disabled={inFlight}
              onClick={(event) => {
                event.stopPropagation();
                promote(row);
              }}
            >
              {inFlight ? "Promoting..." : "Promote"}
            </button>
          );
        },
      },
      { key: "owner", label: "Owner" },
      { key: "status", label: "Status" },
      { key: "primary_domain", label: "Domain" },
      {
        key: "updated_at",
        label: "Updated",
        render: (row) =>
          row.updated_at
            ? new Date(
                row.updated_at.value || row.updated_at,
              ).toLocaleDateString()
            : "-",
      },
    ],
    [promotingIds, promotedStages, promote],
  );

  const columns = tab === "companies" ? companyColumns : PEOPLE_COLUMNS;

  function switchTab(next) {
    if (next === tab) return;
    setSearch("");
    setDebouncedSearch("");
    setTab(next);
  }

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await apiFetch("/api/togari/refresh", {
        method: "POST",
        body: JSON.stringify({}),
      });
      reload();
    } catch (err) {
      setRefreshError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="dash-split">
      <section className="dash-split__main">
        <div className="dash-page-head">
          <h1>Mass Data Explorer</h1>
          <div className="dash-page-head__meta">
            <span>{data ? `${data.total} ${active.countLabel}` : ""}</span>
            <button
              className="dash-btn"
              onClick={refresh}
              disabled={refreshing}
            >
              {refreshing ? "Pulling sources..." : "Refresh from sources"}
            </button>
          </div>
        </div>
        <div className="dash-seg" role="tablist" aria-label="Explorer view">
          <button
            className={`dash-seg__btn${tab === "people" ? " dash-seg__btn--active" : ""}`}
            role="tab"
            aria-selected={tab === "people"}
            onClick={() => switchTab("people")}
          >
            People
          </button>
          <button
            className={`dash-seg__btn${tab === "companies" ? " dash-seg__btn--active" : ""}`}
            role="tab"
            aria-selected={tab === "companies"}
            onClick={() => switchTab("companies")}
          >
            Companies
          </button>
        </div>
        {refreshError && (
          <div className="dash-grid__error">Refresh failed. {refreshError}</div>
        )}
        {promoteError && (
          <div className="dash-grid__error">Promote failed. {promoteError}</div>
        )}
        <DataGrid
          columns={columns}
          rows={data?.rows}
          rowKey={active.rowKey}
          searchValue={search}
          onSearchChange={setSearch}
          loading={loading}
          error={error}
          emptyLabel={active.emptyLabel}
          onRowClick={(row) =>
            tab === "people"
              ? navigate(`/dash/data/person/${row.person_id}`)
              : navigate(`/dash/clients/${row.client_id}`)
          }
        />
      </section>
      <ChatPanel />
    </div>
  );
}
