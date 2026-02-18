'use server'

import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

// ---------------------------------------------------------------------------
// Auth guard — all actions require super_admin
// ---------------------------------------------------------------------------

async function assertSuperAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: ok } = await supabase.schema('core').rpc('is_super_admin')
  if (!ok) throw new Error('Not authorized')

  return user
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export type TriggerBootstrapResult =
  | { ok: true; runId?: string }
  | { ok: false; error: string }

/**
 * Fire-and-forget: POST to readvise internal API to start bootstrap pipeline.
 * Returns immediately with 202 — the run is tracked in sense_ingest_runs_market_bootstrap.
 */
export async function triggerBootstrap(
  marketKey: string
): Promise<TriggerBootstrapResult> {
  try {
    await assertSuperAdmin()

    const baseUrl = process.env.READVISE_INTERNAL_URL
    if (!baseUrl) {
      return { ok: false, error: 'READVISE_INTERNAL_URL is not configured' }
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) {
      return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' }
    }

    const res = await fetch(`${baseUrl}/api/internal/sense/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ marketKey }),
    })

    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: `Bootstrap API returned ${res.status}: ${body}` }
    }

    revalidatePath('/sense/markets')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export type ValidateResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string }

export async function validateMarket(marketKey: string): Promise<ValidateResult> {
  try {
    await assertSuperAdmin()

    const baseUrl = process.env.READVISE_INTERNAL_URL
    if (!baseUrl) {
      return { ok: false, error: 'READVISE_INTERNAL_URL is not configured' }
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) {
      return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' }
    }

    const res = await fetch(`${baseUrl}/api/internal/sense/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ marketKey }),
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: `Validate API returned ${res.status}: ${JSON.stringify(body)}` }
    }

    return { ok: true, result: body }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Publish (set market availability status = 'available')
// ---------------------------------------------------------------------------

export type PublishResult = { ok: true } | { ok: false; error: string }

export async function publishMarket(marketId: string): Promise<PublishResult> {
  try {
    await assertSuperAdmin()
    const admin = getAdminClient()

    const { error } = await admin
      .schema('core')
      .from('sense_market_availability')
      .upsert(
        {
          market_id: marketId,
          status: 'available',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'market_id' }
      )

    if (error) return { ok: false, error: error.message }

    revalidatePath('/sense/markets')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Approve market request
// ---------------------------------------------------------------------------

export type ApproveRequestResult = { ok: true } | { ok: false; error: string }

export async function approveMarketRequest(
  requestId: string,
  resolvedMarketKey?: string
): Promise<ApproveRequestResult> {
  try {
    await assertSuperAdmin()
    const admin = getAdminClient()

    const update: Record<string, unknown> = {
      status: 'planned',
      updated_at: new Date().toISOString(),
    }
    if (resolvedMarketKey) {
      update.resolved_market_key = resolvedMarketKey
    }

    const { error } = await admin
      .schema('core')
      .from('market_requests')
      .update(update)
      .eq('id', requestId)

    if (error) return { ok: false, error: error.message }

    revalidatePath('/sense/requests')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Reject market request
// ---------------------------------------------------------------------------

export type RejectRequestResult = { ok: true } | { ok: false; error: string }

export async function rejectMarketRequest(
  requestId: string,
  note?: string
): Promise<RejectRequestResult> {
  try {
    await assertSuperAdmin()
    const admin = getAdminClient()

    const { error } = await admin
      .schema('core')
      .from('market_requests')
      .update({
        status: 'closed',
        note: note ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)

    if (error) return { ok: false, error: error.message }

    revalidatePath('/sense/requests')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
