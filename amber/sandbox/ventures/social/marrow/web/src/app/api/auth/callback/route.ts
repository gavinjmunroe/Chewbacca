import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database } from '@/types/database'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const cookieStore = await cookies()

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Read-only cookie store in Server Components — middleware handles propagation
          }
        },
      },
    }
  )

  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchange error:', error.message)
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    )
  }

  // Process pending org invite if this user was invited via inviteUserByEmail
  const pendingOrgId = sessionData?.user?.user_metadata?.pending_org_id as string | undefined
  const pendingOrgRole = sessionData?.user?.user_metadata?.pending_org_role as string | undefined

  if (pendingOrgId && pendingOrgRole && sessionData?.user?.id) {
    try {
      const serviceClient = createServiceClient()
      // Check if membership already exists (may have been inserted at invite time)
      const svcSb = serviceClient as any
      const { data: existing } = await svcSb
        .from('org_members')
        .select('id')
        .eq('org_id', pendingOrgId)
        .eq('user_id', sessionData.user.id)
        .maybeSingle()

      if (!existing) {
        await svcSb.from('org_members').insert({
          org_id: pendingOrgId,
          user_id: sessionData.user.id,
          role: pendingOrgRole as 'admin' | 'reviewer',
          invited_by: null,
        })
      }

      // Clear the pending invite from user metadata
      await serviceClient.auth.admin.updateUserById(sessionData.user.id, {
        user_metadata: { pending_org_id: null, pending_org_role: null },
      })
    } catch (err) {
      console.error('[auth/callback] pending invite processing failed:', err)
    }
  }

  // Ensure redirect stays within the same origin
  const redirectTo = next.startsWith('/') ? `${origin}${next}` : `${origin}/dashboard`

  return NextResponse.redirect(redirectTo)
}
