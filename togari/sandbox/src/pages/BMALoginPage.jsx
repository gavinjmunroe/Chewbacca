import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { checkPassword, saveSession } from '../auth/bmaAuth.js'

export default function BMALoginPage() {
  const [password, setPassword]   = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const navigate                  = useNavigate()

  function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Small artificial delay so it doesn't feel instant (optional UX touch)
    setTimeout(() => {
      if (checkPassword(password)) {
        saveSession()
        navigate('/team', { replace: true })
      } else {
        setError('Incorrect password. Please try again.')
        setPassword('')
      }
      setLoading(false)
    }, 380)
  }

  return (
    <div className="bma-login-shell">

      {/* Card */}
      <div className="bma-login-card">

        {/* Logo */}
        <div className="bma-login-logo-wrap">
          <img src="/bma.png" alt="Blue Modern Advisory" className="bma-login-logo" />
        </div>

        {/* Heading */}
        <h1 className="bma-login-heading">BMA Login</h1>
        <p className="bma-login-sub">Team-only access. Enter your shared password to continue.</p>

        {/* Form */}
        <form className="bma-login-form" onSubmit={handleSubmit} noValidate>
          <div className="bma-login-field">
            <label htmlFor="bma-password" className="bma-login-label">Password</label>
            <input
              id="bma-password"
              type="password"
              className={`bma-login-input${error ? ' bma-login-input--error' : ''}`}
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="Enter team password"
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>

          {error && (
            <div className="bma-login-error" role="alert">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="bma-login-btn"
            disabled={loading || !password}
          >
            {loading ? (
              <span className="bma-login-spinner" aria-hidden="true" />
            ) : null}
            {loading ? 'Checking…' : 'Log In'}
          </button>
        </form>

        <p className="bma-login-footer">
          Blue Modern Advisory · Internal access only
        </p>
      </div>
    </div>
  )
}
