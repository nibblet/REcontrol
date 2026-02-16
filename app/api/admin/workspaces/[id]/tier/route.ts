import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/admin/rate-limit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workspaceId } = await params

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Rate limiting check
    const rateLimitResult = checkRateLimit(user.id)
    if (!rateLimitResult.allowed) {
      const resetInSeconds = Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Please wait before making more changes.',
          resetInSeconds,
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimitResult.resetAt.toString(),
          },
        }
      )
    }

    const body = await request.json()
    const { tier, reason } = body

    if (!tier || !reason) {
      return NextResponse.json(
        { error: 'Missing required fields: tier, reason' },
        { status: 400 }
      )
    }

    // Get client IP and user agent for audit logging
    const clientIp = request.headers.get('x-forwarded-for') ||
                     request.headers.get('x-real-ip') ||
                     'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Call admin RPC
    const { data, error } = await supabase
      .schema('core')
      .rpc('admin_set_workspace_tier', {
        p_workspace_id: workspaceId,
        p_tier: tier,
        p_reason: reason,
        p_actor_ip: clientIp,
        p_actor_user_agent: userAgent,
      })

    if (error) {
      console.error('Error setting workspace tier:', error)
      return NextResponse.json(
        { error: error.message || 'Failed to update tier' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { success: true, data },
      {
        headers: {
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': rateLimitResult.resetAt.toString(),
        },
      }
    )
  } catch (error) {
    console.error('Error in tier API route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
