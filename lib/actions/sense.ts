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

function getReadviseInternalUrl() {
  const baseUrl = process.env.READVISE_INTERNAL_URL
  if (!baseUrl) throw new Error('READVISE_INTERNAL_URL is not configured')
  return baseUrl
}

function getServiceKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return key
}

function internalHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getServiceKey()}`,
  }
}

// ---------------------------------------------------------------------------
// Bootstrap (full pipeline)
// ---------------------------------------------------------------------------

export type TriggerBootstrapResult =
  | { ok: true }
  | { ok: false; error: string }

export async function triggerBootstrap(
  marketKey: string
): Promise<TriggerBootstrapResult> {
  try {
    await assertSuperAdmin()
    const res = await fetch(`${getReadviseInternalUrl()}/api/internal/sense/bootstrap`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ marketKey }),
    })
    if (!res.ok) {
      return { ok: false, error: `Bootstrap API returned ${res.status}: ${await res.text()}` }
    }
    revalidatePath(`/sense/markets`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Run individual stage
// ---------------------------------------------------------------------------

export type SenseStage =
  | 'tracts'
  | 'crosswalk'
  | 'acs'
  | 'zillow'
  | 'hud_safmr'
  | 'snapshots'
  | 'neighborhoods'
  | 'validate'
  | 'publish'

export type RunStageOptions = {
  acsYear?: number
  asOfQuarter?: string
  safmrXlsxPath?: string
  safmrFyYear?: number
  zillowDatasets?: string[]
  zillowMonthsBack?: number
  workspaceId?: string   // required for snapshots / neighborhoods
}

export type RunStageResult =
  | { ok: true; async: true }
  | { ok: true; async: false; result: Record<string, unknown> }
  | { ok: false; error: string }

const ASYNC_STAGES: SenseStage[] = [
  'tracts', 'crosswalk', 'acs', 'zillow', 'hud_safmr', 'snapshots', 'neighborhoods',
]

export async function runStage(
  marketKey: string,
  stage: SenseStage,
  options?: RunStageOptions
): Promise<RunStageResult> {
  try {
    await assertSuperAdmin()
    const res = await fetch(`${getReadviseInternalUrl()}/api/internal/sense/run-stage`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ marketKey, stage, options: options ?? {} }),
    })

    const isAsync = ASYNC_STAGES.includes(stage)
    if (isAsync && res.status === 202) {
      revalidatePath(`/sense/markets`)
      return { ok: true, async: true }
    }

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: body.error ?? `API returned ${res.status}` }
    }

    revalidatePath(`/sense/markets`)
    return { ok: true, async: false, result: body }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Enable / Disable market
// ---------------------------------------------------------------------------

export type ToggleEnabledResult = { ok: true } | { ok: false; error: string }

export async function toggleMarketEnabled(
  marketId: string,
  enabled: boolean
): Promise<ToggleEnabledResult> {
  try {
    await assertSuperAdmin()
    const admin = getAdminClient()

    const { error } = await admin
      .schema('core')
      .from('sense_markets')
      .update({ enabled })
      .eq('id', marketId)

    if (error) return { ok: false, error: error.message }

    revalidatePath('/sense/markets')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Validate (sync — returns readiness result)
// ---------------------------------------------------------------------------

export type ValidateResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string }

export async function validateMarket(marketKey: string): Promise<ValidateResult> {
  try {
    await assertSuperAdmin()
    const res = await fetch(`${getReadviseInternalUrl()}/api/internal/sense/validate`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ marketKey }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: body.error ?? `Validate API returned ${res.status}` }
    }
    return { ok: true, result: body }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Publish (validate + write availability)
// ---------------------------------------------------------------------------

export type PublishResult = { ok: true; result: Record<string, unknown> } | { ok: false; error: string }

export async function publishMarket(marketId: string, marketKey: string): Promise<PublishResult> {
  try {
    await assertSuperAdmin()
    const res = await fetch(`${getReadviseInternalUrl()}/api/internal/sense/run-stage`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ marketKey, stage: 'publish' }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: body.error ?? `Publish API returned ${res.status}` }
    }
    revalidatePath('/sense/markets')
    return { ok: true, result: body }
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
