'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { loginSchema, type LoginInput } from '@/lib/validations'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') ?? '/dashboard'

  const [showPassword, setShowPassword] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  async function onSubmit(data: LoginInput) {
    setAuthError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        setAuthError('Incorrect email or password. Please try again.')
      } else if (error.message.includes('Email not confirmed')) {
        setAuthError('Please confirm your email address before signing in.')
      } else {
        setAuthError(error.message)
      }
      return
    }

    toast.success('Welcome back!')
    router.push(redirect)
    router.refresh()
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
          <h1 className="text-2xl font-bold text-stone-900">Welcome back</h1>
          <p className="text-sm text-stone-500 mt-1">Sign in to your Marrow account</p>
        </div>

        {/* Auth error */}
        {authError && (
          <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {authError}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-sm font-medium text-stone-700">
                Password
              </Label>
              <Link
                href="/forgot-password"
                className="text-xs text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                autoComplete="current-password"
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

          <Button
            type="submit"
            isLoading={isSubmitting}
            loadingText="Signing in..."
            className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg"
          >
            <LogIn className="w-4 h-4" />
            Sign in
          </Button>
        </form>

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-stone-500">
          Don&apos;t have an account?{' '}
          <Link
            href="/signup"
            className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            Create one
          </Link>
        </div>
      </div>

      {/* Legal note */}
      <p className="mt-4 text-center text-xs text-stone-400">
        By signing in you agree to our{' '}
        <a href="/terms" className="underline hover:text-stone-600">
          Terms of Service
        </a>{' '}
        and{' '}
        <a href="/privacy" className="underline hover:text-stone-600">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 animate-pulse">
          <div className="h-64 bg-stone-100 rounded-lg" />
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
