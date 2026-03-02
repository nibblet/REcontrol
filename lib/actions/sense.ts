'use server'

import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { runMarketBootstrap } from '@/lib/sense/market-bootstrap-orchestrator'
import { runStageLocal } from '@/lib/sense/run-stage'
import { runMonthlySnapshotsJob } from '@/lib/sense/run-monthly-snapshots'
import { ingestSafmrFromBuffer } from '@/lib/sense/safmr-ingest'
import { getCurrentQuarter } from '@/lib/sense/zip-tract-crosswalk-ingest'

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
// Bootstrap (full pipeline)
// ---------------------------------------------------------------------------

export type TriggerBootstrapResult =
  | { ok: true }
  | { ok: false; error: string }

const SENSE_ADMIN_WORKSPACE_ID =
  process.env.SENSE_ADMIN_WORKSPACE_ID ?? '00000000-0000-0000-0000-000000000000'

export async function triggerBootstrap(
  marketKey: string,
  options?: { force?: boolean }
): Promise<TriggerBootstrapResult> {
  try {
    await assertSuperAdmin()
    // Bootstrap = market-level data including snapshots (one row per market/tract/month; no workspace required).
    runMarketBootstrap(SENSE_ADMIN_WORKSPACE_ID, marketKey, {
      force: options?.force ?? false,
      runSnapshots: true,
    }).catch(
      (err) => console.error('[Sense bootstrap]', err instanceof Error ? err.message : err, { marketKey })
    )
    revalidatePath(`/sense/markets`)
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Sense bootstrap]', error, { marketKey, err })
    return { ok: false, error: error || 'Bootstrap request failed (check server logs)' }
  }
}

// ---------------------------------------------------------------------------
// Run individual stage
// ---------------------------------------------------------------------------

export type SenseStage =
  | 'tracts'
  | 'geometry'
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

export async function runStage(
  marketKey: string,
  stage: SenseStage,
  options?: RunStageOptions
): Promise<RunStageResult> {
  try {
    await assertSuperAdmin()
    const result = await runStageLocal(marketKey, stage, options ?? {})
    if (result.ok) {
      revalidatePath(`/sense/markets`)
    }
    return result
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Import SAFMR (upload XLSX and run hud_safmr in readvise)
// ---------------------------------------------------------------------------

export type ImportSafmrResult =
  | { ok: true; async?: true }
  | { ok: false; error: string }

function quarterToDate(year: number, quarter: number): string {
  const month = (quarter - 1) * 3 + 1
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export async function importSafmr(formData: FormData): Promise<ImportSafmrResult> {
  try {
    await assertSuperAdmin()

    const marketKey = formData.get('marketKey') as string | null
    const file = formData.get('file') as File | null
    const safmrFyYearRaw = formData.get('safmrFyYear') as string | null

    if (!marketKey?.trim()) {
      return { ok: false, error: 'Market is required' }
    }
    if (!file || !(file instanceof Blob) || file.size === 0) {
      return { ok: false, error: 'Please select an XLSX file' }
    }
    const name = (file as File).name?.toLowerCase() ?? ''
    if (!name.endsWith('.xlsx')) {
      return { ok: false, error: 'File must be an .xlsx file' }
    }

    const admin = getAdminClient()
    const { data: market, error: marketErr } = await admin
      .schema('core')
      .from('sense_markets')
      .select('id')
      .eq('market_key', marketKey.trim())
      .maybeSingle()

    if (marketErr || !market) {
      return { ok: false, error: `Market not found: ${marketKey}` }
    }

    const buffer = Buffer.from(await (file as File).arrayBuffer())
    const year = safmrFyYearRaw?.trim() ? parseInt(safmrFyYearRaw, 10) : 2025
    if (!Number.isFinite(year)) {
      return { ok: false, error: 'Invalid SAFMR fiscal year' }
    }
    const { year: qYear, quarter: qQuarter } = getCurrentQuarter()
    const asOfQuarter = quarterToDate(qYear, qQuarter)

    await ingestSafmrFromBuffer({
      buffer,
      year,
      sourceVintage: `fy${year}`,
      marketId: market.id,
      marketKey: marketKey.trim(),
      asOfQuarter,
    })

    revalidatePath('/sense/markets')
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Sense import-safmr]', error, { err })
    return { ok: false, error: error }
  }
}

// ---------------------------------------------------------------------------
// Monthly snapshots (super admin only)
// ---------------------------------------------------------------------------

export type RunMonthlySnapshotsResult =
  | { ok: true; marketsProcessed: number }
  | { ok: false; error: string; marketsProcessed?: number; errors?: Array<{ marketKey: string; error: string }> }

export async function runMonthlySnapshots(): Promise<RunMonthlySnapshotsResult> {
  try {
    await assertSuperAdmin()
    const result = await runMonthlySnapshotsJob()
    if (result.ok) {
      return { ok: true, marketsProcessed: result.marketsProcessed }
    }
    return {
      ok: false,
      error: result.errors.map((e) => `${e.marketKey}: ${e.error}`).join('; ') || 'Unknown error',
      marketsProcessed: result.marketsProcessed,
      errors: result.errors,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Sense runMonthlySnapshots]', error, { err })
    return { ok: false, error }
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
    const out = await runStageLocal(marketKey, 'validate', {})
    if (!out.ok) return { ok: false, error: out.error }
    if (out.async) return { ok: false, error: 'Unexpected async response from validate' }
    return { ok: true, result: out.result }
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
    const out = await runStageLocal(marketKey, 'publish', {})
    if (!out.ok) return { ok: false, error: out.error }
    if (out.async) return { ok: false, error: 'Unexpected async response from publish' }
    revalidatePath('/sense/markets')
    return { ok: true, result: out.result }
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
