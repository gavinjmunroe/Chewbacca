import { useState } from 'react'
import {
  AuthShell, AuthCard, AuthHeading,
  InputField, PrimaryButton, AuthError,
  AuthFooter, AuthBack,
} from '../components/AuthComponents.jsx'

export default function GetStartedPage() {
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [company,  setCompany]  = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const allFilled = name && email && company && password

  function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!allFilled) { setError('Please fill in all fields.'); return }
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      // TODO: wire up real account creation
      setError('Account creation is not yet configured. Contact your BMA administrator.')
    }, 500)
  }

  return (
    <AuthShell>
      <AuthBack />
      <AuthCard>
        <AuthHeading
          title="Get started with BMA"
          sub="Create your workspace and begin building your AI-powered GTM system."
        />

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <InputField
            label="Your name"
            id="gs-name"
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            placeholder="First Last"
            autoComplete="name"
            autoFocus
            hasError={!!error}
          />
          <InputField
            label="Work email"
            id="gs-email"
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setError('') }}
            placeholder="you@company.com"
            autoComplete="email"
            hasError={!!error}
          />
          <InputField
            label="Company"
            id="gs-company"
            type="text"
            value={company}
            onChange={e => { setCompany(e.target.value); setError('') }}
            placeholder="Acme Corp"
            autoComplete="organization"
            hasError={!!error}
          />
          <InputField
            label="Password"
            id="gs-password"
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError('') }}
            placeholder="Create a password"
            autoComplete="new-password"
            hasError={!!error}
          />

          <AuthError message={error} />

          <PrimaryButton loading={loading} disabled={!allFilled}>
            Create account
          </PrimaryButton>
        </form>

        <AuthFooter
          text="Already have an account?"
          linkText="Login"
          linkTo="/login"
        />
      </AuthCard>
    </AuthShell>
  )
}
