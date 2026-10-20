import { createContext, useContext, useState, useEffect } from 'react'

const GOOGLE_SESSION_KEY = 'bma_google_session'
const GOOGLE_CRED_KEY    = 'bma_google_cred'   // localStorage — persists across tabs and refreshes

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isBmaMember,     setIsBmaMember]     = useState(false)
  const [user,            setUser]            = useState(null)
  const [credential,      setCredential]      = useState(null)
  // authLoading is true until the stored session has been read — prevents a
  // flash of "sign in" on pages that just need a moment to hydrate from storage
  const [authLoading,     setAuthLoading]     = useState(true)

  // Restore persisted session on mount
  useEffect(() => {
    async function restoreSession() {
      const storedUser = localStorage.getItem(GOOGLE_SESSION_KEY)
      const storedCred = localStorage.getItem(GOOGLE_CRED_KEY)
      if (!storedUser || !storedCred) {
        setAuthLoading(false)
        return
      }

      try {
        const response = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: storedCred }),
        })
        if (!response.ok) throw new Error('Session expired')
        const data = await response.json()
        const savedUser = data.user || JSON.parse(storedUser)
        setUser(savedUser)
        setCredential(storedCred)
        setIsAuthenticated(true)
        setIsBmaMember(true)
      } catch {
        localStorage.removeItem(GOOGLE_SESSION_KEY)
        localStorage.removeItem(GOOGLE_CRED_KEY)
      } finally {
        setAuthLoading(false)
      }
    }
    restoreSession()
  }, [])

  // Google Sign-In — verify the ID token server-side before creating a session.
  async function googleLogin(idToken) {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: idToken }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.user) {
      throw new Error(data.error || 'Your account could not be verified.')
    }
    const user = data.user

    localStorage.setItem(GOOGLE_SESSION_KEY, JSON.stringify(user))
    localStorage.setItem(GOOGLE_CRED_KEY, idToken)
    setCredential(idToken)
    setUser(user)
    setIsAuthenticated(true)
    setIsBmaMember(true)
    return user
  }

  function logout() {
    localStorage.removeItem(GOOGLE_SESSION_KEY)
    localStorage.removeItem(GOOGLE_CRED_KEY)
    setCredential(null)
    setUser(null)
    setIsAuthenticated(false)
    setIsBmaMember(false)
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isBmaMember, user, credential, authLoading, googleLogin, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
