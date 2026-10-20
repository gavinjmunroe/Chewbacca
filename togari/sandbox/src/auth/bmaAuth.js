/**
 * BMA Team Auth  -  simple shared-password login
 *
 * Set VITE_PORTAL_PASSWORD in Netlify environment variables (and .env.local).
 * Never hardcode the password here.
 */

const BMA_PASSWORD  = import.meta.env.VITE_PORTAL_PASSWORD || ''
const STORAGE_KEY   = 'bma_team_auth'
const SESSION_VALUE = 'authenticated'

export function checkPassword(input) {
  if (!BMA_PASSWORD) return false   // fail closed if env var missing
  return input === BMA_PASSWORD
}

export function saveSession() {
  localStorage.setItem(STORAGE_KEY, SESSION_VALUE)
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY)
}

export function isAuthenticated() {
  return localStorage.getItem(STORAGE_KEY) === SESSION_VALUE
}
