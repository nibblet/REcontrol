/**
 * Admin read queries for Sense management pages.
 * Market/availability data: anon client (super_admin RLS policies).
 * market_requests: service_role client (workspace-member-only RLS).
 */

import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SenseMarketRow = {
  id: string
  market_key: string
  name: string
  cbsa_code: string | null
  created_at: string
  // from sense_market_availability (nullable — row may not exist yet)
  status: string | null
  has_tracts: boolean | null
  has_geometry: boolean | null
  has_projections: boolean | null
  has_hpi: boolean | null
  has_neighborhoods: boolean | null
  has_safmr: boolean | null
  notes: string | null
  availability_updated_at: string | null
}

export type BootstrapRunRow = {
  id: string
  status: string
  step_status: Record<string, { status: string; error?: string }> | null
  counters: Record<string, number> | null
  error: string | null
  run_at: string
  started_at: string | null
  finished_at: string | null
}

export type MarketDetailData = {
  market: SenseMarketRow
  tractCount: number
  countyCount: number
  recentRuns: BootstrapRunRow[]
}

export type MarketRequestRow = {
  id: string
  workspace_id: string
  workspace_name: string | null
  requested_by: string
  raw_input: string
  resolved_market_key: string | null
  status: string
  note: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Markets list
// ---------------------------------------------------------------------------

export async function adminListSenseMarkets(): Promise<SenseMarketRow[]> {
  const supabase = await createClient()

  // Fetch markets
  const { data: markets, error: mErr } = await supabase
    .schema('core')
    .from('sense_markets')
    .select('id, market_key, name, cbsa_code, created_at')
    .order('name')

  if (mErr) throw new Error(`Failed to load sense_markets: ${mErr.message}`)
  if (!markets?.length) return []

  // Fetch availability for all markets
  const { data: availability } = await supabase
    .schema('core')
    .from('sense_market_availability')
    .select(
      'market_id, status, has_tracts, has_geometry, has_projections, has_hpi, has_neighborhoods, has_safmr, notes, updated_at'
    )

  const availMap = new Map(
    (availability ?? []).map((a: Record<string, unknown>) => [a.market_id as string, a])
  )

  return markets.map((m) => {
    const avail = availMap.get(m.id) as Record<string, unknown> | undefined
    return {
      id: m.id,
      market_key: m.market_key,
      name: m.name,
      cbsa_code: m.cbsa_code,
      created_at: m.created_at,
      status: (avail?.status as string) ?? null,
      has_tracts: (avail?.has_tracts as boolean) ?? null,
      has_geometry: (avail?.has_geometry as boolean) ?? null,
      has_projections: (avail?.has_projections as boolean) ?? null,
      has_hpi: (avail?.has_hpi as boolean) ?? null,
      has_neighborhoods: (avail?.has_neighborhoods as boolean) ?? null,
      has_safmr: (avail?.has_safmr as boolean) ?? null,
      notes: (avail?.notes as string) ?? null,
      availability_updated_at: (avail?.updated_at as string) ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// Market detail
// ---------------------------------------------------------------------------

export async function adminGetSenseMarketDetail(
  marketId: string
): Promise<MarketDetailData | null> {
  const supabase = await createClient()

  const { data: market, error: mErr } = await supabase
    .schema('core')
    .from('sense_markets')
    .select('id, market_key, name, cbsa_code, created_at')
    .eq('id', marketId)
    .maybeSingle()

  if (mErr) throw new Error(`Failed to load market: ${mErr.message}`)
  if (!market) return null

  const [availResult, tractCountResult, countyCountResult, runsResult] = await Promise.all([
    supabase
      .schema('core')
      .from('sense_market_availability')
      .select(
        'market_id, status, has_tracts, has_geometry, has_projections, has_hpi, has_neighborhoods, has_safmr, notes, updated_at'
      )
      .eq('market_id', marketId)
      .maybeSingle(),

    supabase
      .schema('core')
      .from('sense_market_tracts')
      .select('tract_id', { count: 'exact', head: true })
      .eq('market_id', marketId)
      .eq('active', true),

    supabase
      .schema('core')
      .from('sense_market_counties')
      .select('county_geoid', { count: 'exact', head: true })
      .eq('market_id', marketId),

    supabase
      .schema('core')
      .from('sense_ingest_runs_market_bootstrap')
      .select('id, status, step_status, counters, error, run_at, started_at, finished_at')
      .eq('market_id', marketId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const avail = availResult.data as Record<string, unknown> | null

  const marketRow: SenseMarketRow = {
    id: market.id,
    market_key: market.market_key,
    name: market.name,
    cbsa_code: market.cbsa_code,
    created_at: market.created_at,
    status: (avail?.status as string) ?? null,
    has_tracts: (avail?.has_tracts as boolean) ?? null,
    has_geometry: (avail?.has_geometry as boolean) ?? null,
    has_projections: (avail?.has_projections as boolean) ?? null,
    has_hpi: (avail?.has_hpi as boolean) ?? null,
    has_neighborhoods: (avail?.has_neighborhoods as boolean) ?? null,
    has_safmr: (avail?.has_safmr as boolean) ?? null,
    notes: (avail?.notes as string) ?? null,
    availability_updated_at: (avail?.updated_at as string) ?? null,
  }

  return {
    market: marketRow,
    tractCount: tractCountResult.count ?? 0,
    countyCount: countyCountResult.count ?? 0,
    recentRuns: (runsResult.data ?? []) as BootstrapRunRow[],
  }
}

// ---------------------------------------------------------------------------
// Market requests (service_role — no super_admin SELECT policy exists)
// ---------------------------------------------------------------------------

export async function adminListMarketRequests(
  status?: string
): Promise<MarketRequestRow[]> {
  const admin = getAdminClient()

  let query = admin
    .schema('core')
    .from('market_requests')
    .select('id, workspace_id, requested_by, raw_input, resolved_market_key, status, note, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (status) {
    query = query.eq('status', status)
  }

  const { data: requests, error: rErr } = await query
  if (rErr) throw new Error(`Failed to load market_requests: ${rErr.message}`)
  if (!requests?.length) return []

  // Fetch workspace names in bulk
  const workspaceIds = [...new Set(requests.map((r: Record<string, unknown>) => r.workspace_id as string))]
  const { data: workspaces } = await admin
    .schema('core')
    .from('workspaces')
    .select('id, name')
    .in('id', workspaceIds)

  const wsMap = new Map(
    (workspaces ?? []).map((w: { id: string; name: string }) => [w.id, w.name])
  )

  return requests.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    workspace_id: r.workspace_id as string,
    workspace_name: wsMap.get(r.workspace_id as string) ?? null,
    requested_by: r.requested_by as string,
    raw_input: r.raw_input as string,
    resolved_market_key: r.resolved_market_key as string | null,
    status: r.status as string,
    note: r.note as string | null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }))
}
