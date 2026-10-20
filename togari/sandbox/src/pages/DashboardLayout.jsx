import { useEffect, useRef } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const TABS = [
  { to: "/dash/data", label: "Data" },
  { to: "/dash/channels", label: "Channels" },
  { to: "/dash/pipeline", label: "Pipeline" },
  { to: "/dash/clients", label: "Clients" },
  { to: "/dash/settings", label: "Settings" },
  { to: "/wiki", label: "Wiki" },
];

export default function DashboardLayout() {
  const { user, authLoading } = useAuth();
  const navRef = useRef(null);
  const { pathname } = useLocation();

  // On narrow screens the tab strip scrolls; keep the active tab in view when
  // the route changes so landing on Settings or Wiki never hides "where am I".
  // Set scrollLeft directly from measured positions (scrollIntoView picks the
  // wrong scroll container here). rAF lets layout settle after a route change;
  // resize re-centers when the strip only becomes scrollable below the mobile
  // breakpoint.
  useEffect(() => {
    const center = () => {
      const nav = navRef.current;
      const active = nav?.querySelector(".dash-tab--active");
      if (!nav || !active) return;
      const delta =
        active.getBoundingClientRect().left -
        nav.getBoundingClientRect().left -
        (nav.clientWidth - active.offsetWidth) / 2;
      nav.scrollLeft += delta;
    };
    const raf = requestAnimationFrame(center);
    window.addEventListener("resize", center);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", center);
    };
    // `user` is a dep because the nav only mounts once auth resolves; without it
    // the first run fires while navRef is still null and never re-runs.
  }, [pathname, user]);

  if (authLoading)
    return <div className="dash-loading">Loading session...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="dash-shell">
      <header className="dash-topbar">
        <span className="dash-brand">Togari</span>
        <nav
          className="dash-tabs"
          aria-label="Dashboard navigation"
          ref={navRef}
        >
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/dash/data"}
              className={({ isActive }) =>
                "dash-tab" + (isActive ? " dash-tab--active" : "")
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <span className="dash-user">{user.email}</span>
      </header>
      <main className="dash-main">
        <Outlet />
      </main>
    </div>
  );
}

export function DashPlaceholder({ title }) {
  return (
    <div className="dash-placeholder">
      <h1>{title}</h1>
      <p>Not built yet.</p>
    </div>
  );
}
