import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: cycleId } = await params
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch cycle to get org_id
    const { data: cycle } = await supabase
      .from('cycles')
      .select('id, org_id, status')
      .eq('id', cycleId)
      .single()

    if (!cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })
    }

    if (cycle.status === 'archived') {
      return NextResponse.json({ error: 'Cycle is already archived' }, { status: 409 })
    }

    // Verify caller is owner or admin
    const { data: membership } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', cycle.org_id)
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: updateError } = await supabase
      .from('cycles')
      .update({ status: 'archived' })
      .eq('id', cycleId)

    if (updateError) {
      console.error('[archive] update error:', updateError.message)
      return NextResponse.json({ error: 'Failed to archive cycle' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[archive] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
