'use client'

import * as React from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
})
type FormInput = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const supabase = createClient()
  const [sent, setSent] = React.useState(false)
  const [submittedEmail, setSubmittedEmail] = React.useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormInput) => {
    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })

    if (error) {
      // Still show the success state to avoid leaking whether an email exists
      console.error('[forgot-password]', error.message)
    }

    setSubmittedEmail(data.email)
    setSent(true)
  }

  if (sent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 bg-stone-50">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="flex justify-center">
            <div className="h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">Check your email</h1>
            <p className="mt-2 text-sm text-stone-500">
              If an account exists for{' '}
              <span className="font-medium text-stone-700">{submittedEmail}</span>, you will receive
              a password reset link shortly.
            </p>
          </div>
          <Link
            href="/login"
            className="text-sm text-stone-500 hover:text-stone-900 underline underline-offset-2"
          >
            Back to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 bg-stone-50">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <Link
            href="/login"
            className="text-xs text-stone-400 hover:text-stone-600 mb-4 flex items-center gap-1"
          >
            Back to login
          </Link>
          <h1 className="text-2xl font-semibold text-stone-900">Reset your password</h1>
          <p className="mt-1 text-sm text-stone-500">
            Enter your email address and we will send you a reset link.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              {...register('email')}
            />
            {errors.email && (
              <p className="text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Sending...' : 'Send reset link'}
          </Button>
        </form>
      </div>
    </div>
  )
}
