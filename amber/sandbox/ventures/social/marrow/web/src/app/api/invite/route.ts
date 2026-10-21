import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendReviewerInvite } from '@/lib/email/send'

interface InviteBody {
  orgId: string
  email: string
  role: 'admin' | 'reviewer'
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: InviteBody = await request.json()
    const { orgId, email, role } = body

    if (!orgId || !email || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const sb = supabase as any

    // Verify inviter is an owner or admin of this org
    const { data: inviterMembership } = await sb
      .from('org_members')
      .select('role, profiles(first_name, last_name)')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .maybeSingle()

    if (!inviterMembership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch org name
    const { data: org } = await sb
      .from('organizations')
      .select('name, slug')
      .eq('id', orgId)
      .single()

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Check if a user with this email already exists
    const { data: existingProfile } = await sb
      .from('profiles')
      .select('id, first_name, last_name')
      .eq('email', email)
      .maybeSingle()

    const inviterProfile = inviterMembership.profiles as {
      first_name: string | null
      last_name: string | null
    } | null
    const inviterName =
      [inviterProfile?.first_name, inviterProfile?.last_name].filter(Boolean).join(' ') ||
      'Your colleague'

    const reviewUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin/${org.slug}`

    if (existingProfile) {
      // Check if already a member
      const { data: existingMember } = await sb
        .from('org_members')
        .select('id')
        .eq('org_id', orgId)
        .eq('user_id', existingProfile.id)
        .maybeSingle()

      if (existingMember) {
        return NextResponse.json(
          { error: 'This person is already a member of this organization' },
          { status: 409 }
        )
      }

      // Add them as a member immediately
      const { error: insertError } = await sb.from('org_members').insert({
        org_id: orgId,
        user_id: existingProfile.id,
        role,
        invited_by: user.id,
      })

      if (insertError) {
        console.error('[invite] insert error:', insertError.message)
        return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
      }

      // Send notification email to existing user
      await sendReviewerInvite(email, {
        reviewerName:
          [existingProfile.first_name, existingProfile.last_name].filter(Boolean).join(' ') ||
          email,
        inviterName,
        orgName: org.name,
        cycleName: 'your next recruiting cycle',
        reviewUrl,
      }).catch((err) => {
        console.error('[invite] email failed:', err)
      })

      return NextResponse.json({ success: true, added: true })
    }

    // New user: use Supabase admin to send an invitation email.
    // The user will be created in auth.users (triggering profile creation),
    // and user_metadata will carry the pending org info for processing in the auth callback.
    const serviceClient = createServiceClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const { data: invitedUser, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(email, {
        data: {
          pending_org_id: orgId,
          pending_org_role: role,
        },
        redirectTo: `${appUrl}/auth/callback?next=/dashboard`,
      })

    if (inviteError) {
      // If user already exists in auth but has no profile (edge case), fall back gracefully
      console.error('[invite] inviteUserByEmail error:', inviteError.message)
      return NextResponse.json({ error: 'Failed to send invitation' }, { status: 500 })
    }

    // If the trigger created a profile synchronously, we can add org membership now.
    // Otherwise the auth callback will handle it when they accept the invite.
    if (invitedUser?.user?.id) {
      const svcSb = createServiceClient() as any
      await svcSb
        .from('org_members')
        .insert({
          org_id: orgId,
          user_id: invitedUser.user.id,
          role,
          invited_by: user.id,
        })
        .then(({ error }: { error: any }) => {
          if (error) console.error('[invite] pre-insert org_members failed (will retry in callback):', error.message)
        })
    }

    return NextResponse.json({ success: true, added: false })
  } catch (err) {
    console.error('[invite] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
