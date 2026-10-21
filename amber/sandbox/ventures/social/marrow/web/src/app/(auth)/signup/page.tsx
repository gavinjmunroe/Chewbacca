'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { createClient } from '@/lib/supabase/client'
import { signupSchema, type SignupInput } from '@/lib/validations'

export default function SignupPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [termsError, setTermsError] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
  })

  async function onSubmit(data: SignupInput) {
    setAuthError(null)
    setTermsError(false)

    if (!accepted) {
      setTermsError(true)
      return
    }

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          first_name: data.first_name,
          last_name: data.last_name,
          full_name: `${data.first_name} ${data.last_name}`,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/profile?onboarding=true`,
      },
    })

    if (error) {
      if (error.message.includes('already registered') || error.message.includes('already exists')) {
        setAuthError('An account with this email already exists. Try signing in instead.')
      } else if (error.message.includes('Password should be')) {
        setAuthError('Password must be at least 8 characters long.')
      } else {
        setAuthError(error.message)
      }
      return
    }

    setEmailSent(data.email)
  }

  if (emailSent) {
    return (
      <div className="w-full max-w-sm animate-fade-in">
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 text-center">
          <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" fill="#059669"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-stone-900">Check your email</h1>
          <p className="text-sm text-stone-500 mt-2">
            We sent a confirmation link to <strong>{emailSent}</strong>. Click it to verify your address and get started.
          </p>
          <p className="text-xs text-stone-400 mt-4">
            Didn&apos;t get it? Check your spam folder or{' '}
            <button onClick={() => setEmailSent(null)} className="text-indigo-600 hover:underline">
              try again
            </button>
            .
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm animate-fade-in">
      {/* Card */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-11 h-11 rounded-xl bg-stone-900 flex items-center justify-center mx-auto mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="5" cy="5" r="3" fill="white" />
              <circle cx="19" cy="5" r="3" fill="white" />
              <circle cx="5" cy="19" r="3" fill="white" />
              <circle cx="19" cy="19" r="3" fill="white" />
              <rect x="7" y="11" width="10" height="2" rx="1" fill="white" />
              <rect x="4" y="7" width="2" height="10" rx="1" fill="white" />
              <rect x="18" y="7" width="2" height="10" rx="1" fill="white" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900">Create your account</h1>
          <p className="text-sm text-stone-500 mt-1">
            Free for student organizations. No credit card needed.
          </p>
        </div>

        {/* Auth error */}
        {authError && (
          <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {authError}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first_name" className="text-sm font-medium text-stone-700">
                First name
              </Label>
              <Input
                id="first_name"
                type="text"
                placeholder="Alex"
                autoComplete="given-name"
                error={!!errors.first_name}
                errorMessage={errors.first_name?.message}
                {...register('first_name')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name" className="text-sm font-medium text-stone-700">
                Last name
              </Label>
              <Input
                id="last_name"
                type="text"
                placeholder="Johnson"
                autoComplete="family-name"
                error={!!errors.last_name}
                errorMessage={errors.last_name?.message}
                {...register('last_name')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-medium text-stone-700">
              Email address
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="you@university.edu"
              autoComplete="email"
              error={!!errors.email}
              errorMessage={errors.email?.message}
              {...register('email')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-sm font-medium text-stone-700">
              Password
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                className="pr-10"
                error={!!errors.password}
                errorMessage={errors.password?.message}
                {...register('password')}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Terms acceptance */}
          <div className="pt-1">
            <div className="flex items-start gap-3">
              <Checkbox
                id="terms"
                checked={accepted}
                onCheckedChange={(val) => {
                  setAccepted(!!val)
                  if (val) setTermsError(false)
                }}
                className="mt-0.5"
              />
              <label
                htmlFor="terms"
                className="text-sm text-stone-600 leading-relaxed cursor-pointer"
              >
                I agree to Marrow&apos;s{' '}
                <a href="/terms" className="text-indigo-600 hover:underline">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/privacy" className="text-indigo-600 hover:underline">
                  Privacy Policy
                </a>
              </label>
            </div>
            {termsError && (
              <p className="mt-1.5 text-xs text-red-500">
                You must accept the terms to create an account.
              </p>
            )}
          </div>

          <Button
            type="submit"
            isLoading={isSubmitting}
            loadingText="Creating account..."
            className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg mt-1"
          >
            <UserPlus className="w-4 h-4" />
            Create account
          </Button>
        </form>

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-stone-500">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            Sign in
          </Link>
        </div>
      </div>

      {/* Trust note */}
      <p className="mt-4 text-center text-xs text-stone-400">
        Free for student organizations · No credit card required
      </p>
    </div>
  )
}
