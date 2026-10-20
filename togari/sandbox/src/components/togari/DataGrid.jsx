export default function DataGrid({
  columns,
  rows,
  rowKey,
  onRowClick,
  searchValue,
  onSearchChange,
  loading,
  error,
  emptyLabel = "No records yet",
}) {
  return (
    <div className="dash-grid">
      {onSearchChange && (
        <input
          className="dash-grid__search"
          type="search"
          placeholder="Search..."
          aria-label="Search records"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      )}
      {error && <div className="dash-grid__error">{error}</div>}
      <table className="dash-grid__table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="dash-grid__state">
                Loading...
              </td>
            </tr>
          ) : !rows?.length ? (
            <tr>
              <td colSpan={columns.length} className="dash-grid__state">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row[rowKey]}
                className={onRowClick ? "dash-grid__row--clickable" : ""}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.render ? c.render(row) : (row[c.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
