import { Link } from "react-router-dom";
import StatCard from "./StatCard.jsx";

export default function DrillDown({
  title,
  subtitle,
  backTo,
  stats = [],
  children,
}) {
  return (
    <div className="dash-drill">
      <Link to={backTo} className="dash-drill__back">
        Back
      </Link>
      <header className="dash-drill__header">
        <h1>{title}</h1>
        {subtitle && <p className="dash-drill__subtitle">{subtitle}</p>}
      </header>
      {stats.length > 0 && (
        <div className="dash-drill__stats">
          {stats.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
