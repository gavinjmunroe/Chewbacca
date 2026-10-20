export default function StatCard({ label, value }) {
  return (
    <div className="dash-stat">
      <span className="dash-stat__value">{value ?? "-"}</span>
      <span className="dash-stat__label">{label}</span>
    </div>
  );
}
