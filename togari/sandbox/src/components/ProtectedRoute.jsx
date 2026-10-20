import { Navigate } from 'react-router-dom'
import { isAuthenticated } from '../auth/bmaAuth.js'

/**
 * Wraps any route that requires BMA team login.
 * If not authenticated → redirect to /bma-login.
 * When upgrading to real auth, replace isAuthenticated()
 * with your provider's check (e.g. useUser(), getSession()).
 */
export default function ProtectedRoute({ children }) {
  if (!isAuthenticated()) {
    return <Navigate to="/bma-login" replace />
  }
  return children
}
