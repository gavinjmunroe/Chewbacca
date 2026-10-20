import { useNavigate } from 'react-router-dom'
import { clearSession } from '../auth/bmaAuth.js'
import Footer from '../components/Footer.jsx'

/**
 * Private internal team page  -  only reachable after login.
 * Expand this with links to Loom recordings, playbooks,
 * client materials, diagnostics, etc. as the product grows.
 */
export default function BMATeamPage() {
  const navigate = useNavigate()

  function handleLogout() {
    clearSession()
    navigate('/bma-login', { replace: true })
  }

  return (
    <div className="bma-team-shell">

      {/* Top bar */}
      <header className="bma-team-topbar">
        <div className="bma-team-topbar-inner">
          <div className="bma-team-brand">
            <img src="/bma.png" alt="BMA" className="bma-team-logo" />
            <span className="bma-team-brand-text">
              <span className="bma-team-brand-dark">BlueModern</span>
              <span className="bma-team-brand-light">Advisory</span>
            </span>
            <span className="bma-team-brand-badge">Team</span>
          </div>
          <button className="bma-team-logout-btn" onClick={handleLogout}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Log out
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="bma-team-main">
        <div className="bma-team-wrap">

          {/* Welcome */}
          <div className="bma-team-hero">
            <span className="bma-team-hero-eyebrow">Internal</span>
            <h1 className="bma-team-hero-heading">Welcome, BMA Team</h1>
            <p className="bma-team-hero-sub">
              This is your private workspace. Materials, playbooks, and client resources
              will live here as the platform grows.
            </p>
          </div>

          {/* Placeholder cards */}
          <div className="bma-team-grid">

            <div className="bma-team-card bma-team-card--coming-soon">
              <div className="bma-team-card-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
              </div>
              <h3 className="bma-team-card-title">Playbooks</h3>
              <p className="bma-team-card-desc">GTM playbooks, ICP frameworks, and engagement templates.</p>
              <span className="bma-team-card-pill">Coming soon</span>
            </div>

            <div className="bma-team-card bma-team-card--coming-soon">
              <div className="bma-team-card-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </div>
              <h3 className="bma-team-card-title">Recordings</h3>
              <p className="bma-team-card-desc">Loom walkthroughs, Fireflies call recordings, and session notes.</p>
              <span className="bma-team-card-pill">Coming soon</span>
            </div>

            <div className="bma-team-card bma-team-card--coming-soon">
              <div className="bma-team-card-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <path d="M8 21h8M12 17v4"/>
                  <path d="M7 8h2l2 4 2-6 2 4h2"/>
                </svg>
              </div>
              <h3 className="bma-team-card-title">Engine Builds</h3>
              <p className="bma-team-card-desc">Active client engine specs, Clay workflow builds, and diagnostics.</p>
              <span className="bma-team-card-pill">Coming soon</span>
            </div>

            <div className="bma-team-card bma-team-card--coming-soon">
              <div className="bma-team-card-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <h3 className="bma-team-card-title">Client Materials</h3>
              <p className="bma-team-card-desc">Engagement summaries, progress views, and deliverable trackers.</p>
              <span className="bma-team-card-pill">Coming soon</span>
            </div>

          </div>

          {/* Info note */}
          <div className="bma-team-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>
              This workspace uses a shared team password. For individual accounts and
              role-based access, this will be upgraded to a proper login provider.
            </span>
          </div>

        </div>
      </main>
      <Footer />
    </div>
  )
}
