import { NextResponse, type NextRequest } from 'next/server'
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/server'

// ── Types ──────────────────────────────────────────────────────────────────────
interface ExportRow {
  applicant_name: string
  email: string
  school: string | null
  graduation_year: number | null
  status: string
  submitted_at: string | null
  current_stage: string | null
  average_score: number | null
  [criterion: string]: string | number | null
  advance_count: number
  reject_count: number
  hold_count: number
  undecided_count: number
}

// ── Route ──────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  try {
    const { cycleId } = await params
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') ?? 'json'

    if (format !== 'csv' && format !== 'json') {
      return NextResponse.json(
        { error: 'Invalid format. Use "csv" or "json".' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Auth check
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify cycle exists and get org_id
    const { data: cycle, error: cycleError } = await supabase
      .from('cycles')
      .select('id, name, org_id')
      .eq('id', cycleId)
      .single()

    if (cycleError || !cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })
    }

    // Admin check: user must be owner or admin in the org
    const { data: membership, error: memberError } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', cycle.org_id)
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .maybeSingle()

    if (memberError || !membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch applications with profiles and current stage
    const { data: applications, error: appError } = await supabase
      .from('applications')
      .select(`
        id,
        status,
        submitted_at,
        current_stage_id,
        profiles (
          email,
          first_name,
          last_name,
          school,
          graduation_year
        ),
        stages (
          name
        )
      `)
      .eq('cycle_id', cycleId)
      .order('submitted_at', { ascending: true })

    if (appError) {
      console.error('[export] applications fetch error:', appError.message)
      return NextResponse.json({ error: 'Failed to fetch applications' }, { status: 500 })
    }

    // Fetch rubric criteria for this cycle's stages
    const { data: criteria } = await supabase
      .from('rubric_criteria')
      .select('id, criterion_name, stage_id, stages!inner(cycle_id)')
      .eq('stages.cycle_id', cycleId)

    // Fetch all reviews + scores for this cycle
    const { data: reviews } = await supabase
      .from('reviews')
      .select(`
        id,
        application_id,
        recommendation,
        is_submitted,
        review_scores (
          criterion_id,
          score
        )
      `)
      .eq('is_submitted', true)

    const reviewsByApp: Record<string, typeof reviews> = {}
    for (const review of reviews ?? []) {
      if (!reviewsByApp[review.application_id]) {
        reviewsByApp[review.application_id] = []
      }
      reviewsByApp[review.application_id]!.push(review)
    }

    // Build export rows
    const rows: ExportRow[] = (applications ?? []).map((app) => {
      const profile = app.profiles as {
        email: string
        first_name: string | null
        last_name: string | null
        school: string | null
        graduation_year: number | null
      } | null

      const appReviews = reviewsByApp[app.id] ?? []

      // Recommendation counts
      const counts = { advance: 0, reject: 0, hold: 0, undecided: 0 }
      for (const r of appReviews) {
        if (r.recommendation && r.recommendation in counts) {
          counts[r.recommendation as keyof typeof counts]++
        }
      }

      // Per-criterion average scores
      const criterionScores: Record<string, number[]> = {}
      for (const r of appReviews) {
        for (const s of r.review_scores ?? []) {
          if (s.score !== null) {
            if (!criterionScores[s.criterion_id]) criterionScores[s.criterion_id] = []
            criterionScores[s.criterion_id].push(s.score)
          }
        }
      }

      // Overall average (mean of all submitted scores)
      const allScores = Object.values(criterionScores).flat()
      const averageScore =
        allScores.length > 0
          ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 100) / 100
          : null

      const row: ExportRow = {
        applicant_name: profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(' ')
          : 'Unknown',
        email: profile?.email ?? '',
        school: profile?.school ?? null,
        graduation_year: profile?.graduation_year ?? null,
        status: app.status,
        submitted_at: app.submitted_at,
        current_stage: (app.stages as { name: string } | null)?.name ?? null,
        average_score: averageScore,
        advance_count: counts.advance,
        reject_count: counts.reject,
        hold_count: counts.hold,
        undecided_count: counts.undecided,
      }

      // Add individual criterion columns
      for (const criterion of criteria ?? []) {
        const scores = criterionScores[criterion.id] ?? []
        const avg =
          scores.length > 0
            ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
            : null
        row[`score_${criterion.criterion_name.toLowerCase().replace(/\s+/g, '_')}`] = avg
      }

      return row
    })

    // ── CSV response ───────────────────────────────────────────────────────────
    if (format === 'csv') {
      const csv = Papa.unparse(rows, { header: true })
      const filename = `${cycle.name.replace(/\s+/g, '_')}_export_${new Date().toISOString().split('T')[0]}.csv`

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    // ── JSON response ──────────────────────────────────────────────────────────
    return NextResponse.json({
      cycle: { id: cycle.id, name: cycle.name },
      exported_at: new Date().toISOString(),
      total: rows.length,
      applications: rows,
    })
  } catch (err) {
    console.error('[export] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
