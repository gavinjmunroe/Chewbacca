export default function MiniBarChart({ data, xKey, yKey, height = 80 }) {
  if (!data?.length)
    return <div className="dash-chart-empty">No activity yet</div>;
  const max = Math.max(...data.map((d) => Number(d[yKey]) || 0), 1);
  const barWidth = 100 / data.length;
  return (
    <svg
      className="dash-minibar"
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="activity over time"
    >
      {data.map((d, i) => {
        const h = ((Number(d[yKey]) || 0) / max) * (height - 4);
        return (
          <rect
            key={d[xKey] ?? i}
            x={i * barWidth + barWidth * 0.15}
            y={height - h}
            width={barWidth * 0.7}
            height={h}
            rx="1"
            className="dash-minibar__bar"
          >
            <title>{`${d[xKey]}: ${d[yKey]}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
