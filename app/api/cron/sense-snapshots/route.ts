import { NextRequest, NextResponse } from 'next/server'
import { runMonthlySnapshotsJob } from '@/lib/sense/run-monthly-snapshots'

/**
 * POST /api/cron/sense-snapshots
 * Run monthly snapshot job for all enabled markets. Protected by CRON_SECRET.
 * Invoke from a scheduler (e.g. Vercel Cron, external cron) with header:
 *   x-cron-secret: <CRON_SECRET>
 * or
 *   Authorization: Bearer <CRON_SECRET>
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    )
  }

  const authHeader = request.headers.get('authorization')
  const cronHeader = request.headers.get('x-cron-secret')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cronHeader

  if (token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runMonthlySnapshotsJob()
    return NextResponse.json({
      ok: result.ok,
      marketsProcessed: result.marketsProcessed,
      errors: result.errors.length ? result.errors : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron sense-snapshots]', message, { err })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
