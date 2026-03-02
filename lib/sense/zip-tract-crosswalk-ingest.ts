/**
 * Populate readvise.sense_zip_tract_crosswalk from HUD ZIP→Tract rows.
 * Tract-first: only rows whose tract_id is in the market's sense_market_tracts (active) are written.
 * Idempotent: upsert by (zip, tract_id, as_of_quarter). Weight = res_ratio.
 */

import { getAdminClient } from '@/lib/supabase/admin';
import { fetchZipTractFromApi, fetchZipTractBulk } from './hud-usps-api';
import type { ZipTractRow } from './sense-cbsa-hud-ingest';

const BATCH_SIZE = 1000;
const ZIP_WEIGHT_SUM_TOLERANCE = 0.001; // per-zip sum of weights should be ~1; log if off

/** Canonical 11-digit tract GEOID so market tracts match HUD crosswalk format (HUD normalizes to 11 digits). */
function normalizeTractId(s: string): string {
  return String(s).replace(/\D/g, '').padStart(11, '0').slice(0, 11);
}

/**
 * Format as_of_quarter as first day of quarter (YYYY-MM-DD).
 */
export function quarterToDate(year: number, quarter: number): string {
  const month = (quarter - 1) * 3 + 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/**
 * Get current quarter (1–4) and year for deterministic as_of_quarter.
 */
export function getCurrentQuarter(): { year: number; quarter: number } {
  const d = new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return { year, quarter };
}

export type UpsertZipTractCrosswalkParams = {
  zipTractRows: ZipTractRow[];
  asOfQuarter: string;
  /** If set, only upsert rows whose tract_id is in this set (e.g. market tracts). */
  tractIdFilter?: Set<string>;
};

export type UpsertZipTractCrosswalkResult = {
  rowsUpserted: number;
  asOfQuarter: string;
};

/**
 * Upsert sense_zip_tract_crosswalk. Idempotent; safe to re-run.
 */
export async function upsertZipTractCrosswalk(
  params: UpsertZipTractCrosswalkParams,
): Promise<UpsertZipTractCrosswalkResult> {
  const admin = getAdminClient();

  const { asOfQuarter, tractIdFilter } = params;
  let rows = params.zipTractRows;

  if (tractIdFilter && tractIdFilter.size > 0) {
    rows = rows.filter((r) => tractIdFilter.has(r.tract_id));
  }

  let rowsUpserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE).map((r) => ({
      zip: r.zip,
      tract_id: r.tract_id,
      weight: r.res_ratio,
      as_of_quarter: asOfQuarter,
    }));

    const { error } = await admin
      .schema('core')
      .from('sense_zip_tract_crosswalk')
      .upsert(chunk, { onConflict: 'zip,tract_id,as_of_quarter' });

    if (error) {
      throw new Error(`sense_zip_tract_crosswalk upsert: ${error.message}`);
    }
    rowsUpserted += chunk.length;
  }

  return { rowsUpserted, asOfQuarter };
}

export type CrosswalkCoverageMetrics = {
  tractsInMarket: number;
  tractsInCrosswalk: number;
  tractsMissingCoverage: number;
  distinctZips: number;
  invalidZipCount: number;
  rowsUpserted: number;
  weightWarnings?: string[];
  /** When there is zero overlap, samples to debug tract ID format (market vs HUD). */
  debug?: {
    hudRowCount: number;
    sampleMarketTractIds: string[];
    sampleHudTractIds: string[];
  };
};

/**
 * Step C: Refresh ZIP→tract crosswalk for a market. Requires market to have tracts in sense_market_tracts.
 * Loads tract allowlist, fetches HUD ZIP-Tract, filters to allowlist, upserts, returns coverage metrics.
 */
export async function refreshCrosswalkForMarket(
  marketId: string,
  options?: { asOfQuarter?: string },
): Promise<{ asOfQuarter: string; coverage: CrosswalkCoverageMetrics }> {
  const admin = getAdminClient();
  const hudKey = process.env.HUD_API_KEY;
  if (!hudKey) throw new Error('HUD_API_KEY is not set');

  const { data: tractRows, error: tractErr } = await admin
    .schema('core')
    .from('sense_market_tracts')
    .select('tract_id')
    .eq('market_id', marketId)
    .eq('active', true);

  if (tractErr) throw new Error(`Failed to load sense_market_tracts: ${tractErr.message}`);
  const allowlist = new Set(
    (tractRows ?? [])
      .map((r: { tract_id: string | null }) => (r.tract_id ? normalizeTractId(r.tract_id) : ''))
      .filter((id): id is string => id.length === 11),
  );

  if (allowlist.size === 0) {
    throw new Error(
      'Tracts not initialized for this market. Run "Build market tracts" first.',
    );
  }

  const { year, quarter } = getCurrentQuarter();
  const asOfQuarter = options?.asOfQuarter ?? quarterToDate(year, quarter);

  const tractIdList = [...allowlist];
  const zipTractRows = await fetchZipTractFromApi(hudKey, {
    tractIds: tractIdList,
  });
  const filtered = zipTractRows.filter((r) => allowlist.has(normalizeTractId(r.tract_id)));

  const result = await upsertZipTractCrosswalk({
    zipTractRows: filtered,
    asOfQuarter,
    tractIdFilter: allowlist,
  });

  const distinctZips = new Set(filtered.map((r) => r.zip)).size;
  const tractsInCrosswalk = new Set(filtered.map((r) => r.tract_id)).size;
  const tractsMissingCoverage = allowlist.size - tractsInCrosswalk;
  const invalidZipCount = zipTractRows.filter((r) => !/^\d{5}$/.test(r.zip)).length;

  const weightWarnings: string[] = [];
  const sumByZip = new Map<string, number>();
  for (const r of filtered) {
    sumByZip.set(r.zip, (sumByZip.get(r.zip) ?? 0) + r.res_ratio);
  }
  for (const [zip, sum] of sumByZip) {
    if (Math.abs(sum - 1) > ZIP_WEIGHT_SUM_TOLERANCE && Math.abs(sum) > 0.0001) {
      weightWarnings.push(`zip ${zip} sum(weight)=${sum.toFixed(4)}`);
    }
  }
  if (weightWarnings.length > 10) {
    weightWarnings.length = 10;
    weightWarnings.push('... (truncated)');
  }

  const coverage: CrosswalkCoverageMetrics = {
    tractsInMarket: allowlist.size,
    tractsInCrosswalk,
    tractsMissingCoverage,
    distinctZips,
    invalidZipCount,
    rowsUpserted: result.rowsUpserted,
    weightWarnings: weightWarnings.length ? weightWarnings : undefined,
  };

  if (tractsInCrosswalk === 0 && zipTractRows.length > 0) {
    const allowlistArr = [...allowlist];
    const hudTractIds = [...new Set(zipTractRows.map((r) => r.tract_id))];
    coverage.debug = {
      hudRowCount: zipTractRows.length,
      sampleMarketTractIds: allowlistArr.slice(0, 10).sort(),
      sampleHudTractIds: hudTractIds.slice(0, 10).sort(),
    };
  }

  return { asOfQuarter, coverage };
}

export type MarketCrosswalkResult = {
  marketId: string;
  marketKey: string;
  asOfQuarter: string;
  coverage: CrosswalkCoverageMetrics;
};

/**
 * Refresh ZIP→tract crosswalk for ALL active markets in a single bulk HUD fetch.
 * Fetches the national type=1 dataset once, then filters and upserts per market.
 */
export async function refreshCrosswalkAllMarkets(
  options?: { asOfQuarter?: string },
): Promise<MarketCrosswalkResult[]> {
  const admin = getAdminClient();
  const hudKey = process.env.HUD_API_KEY;
  if (!hudKey) throw new Error('HUD_API_KEY is not set');

  const { year, quarter } = getCurrentQuarter();
  const asOfQuarter = options?.asOfQuarter ?? quarterToDate(year, quarter);

  const { data: markets, error: mErr } = await admin
    .schema('core')
    .from('sense_markets')
    .select('id, market_key');
  if (mErr) throw new Error(`Failed to load sense_markets: ${mErr.message}`);
  if (!markets?.length) return [];

  const marketTracts = new Map<string, { marketKey: string; allowlist: Set<string> }>();
  for (const market of markets) {
    const { data: tractRows, error: tErr } = await admin
      .schema('core')
      .from('sense_market_tracts')
      .select('tract_id')
      .eq('market_id', market.id)
      .eq('active', true);
    if (tErr) throw new Error(`Failed to load tracts for ${market.market_key}: ${tErr.message}`);
    const allowlist = new Set(
      (tractRows ?? [])
        .map((r: { tract_id: string | null }) => (r.tract_id ? normalizeTractId(r.tract_id) : ''))
        .filter((id): id is string => id.length === 11),
    );
    if (allowlist.size > 0) {
      marketTracts.set(market.id, { marketKey: market.market_key, allowlist });
    }
  }

  if (marketTracts.size === 0) return [];

  const allRows = await fetchZipTractBulk(hudKey);

  const rowsByTract = new Map<string, ZipTractRow[]>();
  for (const row of allRows) {
    const tid = normalizeTractId(row.tract_id);
    if (!rowsByTract.has(tid)) rowsByTract.set(tid, []);
    rowsByTract.get(tid)!.push(row);
  }

  const results: MarketCrosswalkResult[] = [];
  for (const [marketId, { marketKey, allowlist }] of marketTracts) {
    const filtered: ZipTractRow[] = [];
    for (const tractId of allowlist) {
      const rows = rowsByTract.get(tractId);
      if (rows) filtered.push(...rows);
    }

    const result = await upsertZipTractCrosswalk({
      zipTractRows: filtered,
      asOfQuarter,
      tractIdFilter: allowlist,
    });

    const distinctZips = new Set(filtered.map((r) => r.zip)).size;
    const tractsInCrosswalk = new Set(filtered.map((r) => normalizeTractId(r.tract_id))).size;

    results.push({
      marketId,
      marketKey,
      asOfQuarter,
      coverage: {
        tractsInMarket: allowlist.size,
        tractsInCrosswalk,
        tractsMissingCoverage: allowlist.size - tractsInCrosswalk,
        distinctZips,
        invalidZipCount: 0,
        rowsUpserted: result.rowsUpserted,
      },
    });
  }

  return results;
}
