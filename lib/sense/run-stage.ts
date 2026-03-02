/**
 * Local run-stage implementation for Sense onboarding.
 * Resolves market, dispatches to stage runners; async stages run in background.
 */

import path from 'path';
import fs from 'fs/promises';
import { getAdminClient } from '@/lib/supabase/admin';
import { buildMarketTracts } from './build-market-tracts';
import { refreshCrosswalkForMarket } from './zip-tract-crosswalk-ingest';
import { ingestAcsForMarket } from './acs-ingest';
import { ingestZillowZipCsv } from './zillow-ingest';
import { ingestSafmrForMarket } from './safmr-ingest';
import { importTractGeometriesForMarket } from './import-tract-geometries';
import { buildSenseSnapshots } from './sense-snapshot-builder';
import {
  LATEST_ACS_5YR,
  DEFAULT_ZILLOW_DATASETS,
  DEFAULT_ZILLOW_MONTHS_BACK,
  DEFAULT_SAFMR_FY_YEAR,
} from './config';
import { quarterToDate, getCurrentQuarter } from './zip-tract-crosswalk-ingest';

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
  | 'publish';

export type RunStageOptions = {
  acsYear?: number;
  asOfQuarter?: string;
  safmrXlsxPath?: string;
  safmrFyYear?: number;
  zillowDatasets?: string[];
  zillowMonthsBack?: number;
  workspaceId?: string;
};

const MONTHS_BACK_AGG = 24;

function addMonths(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function datasetToCsvPath(dataset: string): string {
  const baseDir = process.env.ZILLOW_CSV_DIR || path.join(process.cwd(), 'remarket_imports');
  return path.join(baseDir, `Zip_${dataset}_month.csv`);
}

async function resolveMarket(
  admin: ReturnType<typeof getAdminClient>,
  marketKey: string
): Promise<{ marketId: string } | { error: string }> {
  const { data, error } = await admin
    .schema('core')
    .from('sense_markets')
    .select('id')
    .eq('market_key', marketKey)
    .maybeSingle();

  if (error || !data) {
    return { error: `Market not found: ${marketKey}` };
  }
  return { marketId: data.id };
}

/** Refresh sense_agg_tract_monthly so Data Coverage "ACS 5-year projections" can show Yes. Exported for use by bootstrap orchestrator. */
export async function refreshAggTractMonthly(marketKey: string): Promise<{ rowsAffected?: number; error?: string }> {
  const admin = getAdminClient();
  const now = new Date();
  const toMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const fromMonth = addMonths(toMonth, -(MONTHS_BACK_AGG - 1));

  let asOfQuarter: string | null = null;
  const { data: quarterData, error: quarterErr } = await admin
    .schema('readvise')
    .rpc('sense_market_latest_crosswalk_quarter', { _market_key: marketKey });
  if (!quarterErr && (quarterData?.[0]?.as_of_quarter ?? quarterData)) {
    asOfQuarter = (quarterData?.[0]?.as_of_quarter ?? quarterData) as string;
  }
  if (!asOfQuarter) {
    const { year, quarter } = getCurrentQuarter();
    asOfQuarter = quarterToDate(year, quarter);
  }

  const { data: aggData, error } = await admin.schema('readvise').rpc('sense_refresh_agg_tract_monthly', {
    _market_key: marketKey,
    _as_of_quarter: asOfQuarter,
    _from_month: fromMonth,
    _to_month: toMonth,
  });
  if (error) {
    console.error(`[run-stage] sense_refresh_agg_tract_monthly failed for ${marketKey}:`, error.message);
    return { error: error.message };
  }
  await admin.schema('readvise').rpc('sense_refresh_market_agg_monthly', {
    _market_key: marketKey,
    _from_month: fromMonth,
    _to_month: toMonth,
  });
  const rowsAffected = typeof aggData === 'number' ? aggData : undefined;
  return { rowsAffected };
}

export async function runStageLocal(
  marketKey: string,
  stage: SenseStage,
  options: RunStageOptions = {}
): Promise<
  | { ok: true; async: true }
  | { ok: true; async: false; result: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const admin = getAdminClient();
  const marketResult = await resolveMarket(admin, marketKey.trim());
  if ('error' in marketResult) {
    return { ok: false, error: marketResult.error };
  }
  const { marketId } = marketResult;

  if ((stage === 'snapshots' || stage === 'neighborhoods') && !options.workspaceId) {
    return { ok: false, error: `Stage "${stage}" requires options.workspaceId` };
  }

  // Sync stages
  if (stage === 'validate') {
    try {
      const { data, error } = await admin
        .schema('readvise')
        .rpc('validate_market_readiness', { _market_id: marketId });
      if (error) throw new Error(error.message);
      return { ok: true, async: false, result: (data ?? {}) as Record<string, unknown> };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  if (stage === 'publish') {
    try {
      const { data: readiness, error: rErr } = await admin
        .schema('readvise')
        .rpc('validate_market_readiness', { _market_id: marketId });
      if (rErr) throw new Error(rErr.message);

      const r = (readiness ?? {}) as Record<string, unknown>;
      const { error: upsertErr } = await admin
        .schema('core')
        .from('sense_market_availability')
        .upsert(
          {
            market_id: marketId,
            status: r.status ?? 'unavailable',
            has_tracts: r.has_tracts ?? false,
            has_geometry: r.has_geometry ?? false,
            has_projections: r.has_projections ?? false,
            has_hpi: r.has_hpi ?? false,
            has_neighborhoods: r.has_neighborhoods ?? false,
            has_safmr: r.has_safmr ?? false,
            notes: r.notes ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'market_id' }
        );
      if (upsertErr) throw new Error(upsertErr.message);
      return { ok: true, async: false, result: { ok: true, status: r.status, readiness: r } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  // Async stages: run in background, return 202-style immediately
  const run = async () => {
    try {
      switch (stage) {
        case 'tracts':
          await buildMarketTracts(marketKey.trim());
          break;
        case 'geometry':
          await importTractGeometriesForMarket(marketKey.trim());
          break;
        case 'crosswalk':
          await refreshCrosswalkForMarket(marketId, { asOfQuarter: options.asOfQuarter });
          break;
        case 'acs': {
          const acsYear = options.acsYear ?? LATEST_ACS_5YR;
          await ingestAcsForMarket({ marketKey: marketKey.trim(), year: acsYear, dryRun: false });
          break;
        }
        case 'zillow': {
          const datasets = options.zillowDatasets?.length ? options.zillowDatasets : DEFAULT_ZILLOW_DATASETS;
          const monthsBack = options.zillowMonthsBack ?? DEFAULT_ZILLOW_MONTHS_BACK;
          const results: Record<string, unknown> = {};
          for (const dataset of datasets) {
            const csvPath = datasetToCsvPath(dataset);
            try {
              const csvText = await fs.readFile(csvPath, 'utf-8');
              results[dataset] = await ingestZillowZipCsv({
                csvText,
                dataset,
                monthsBack,
                marketId,
              });
            } catch {
              results[dataset] = { skipped: true, reason: `CSV not found: ${csvPath}` };
            }
          }
          break;
        }
        case 'hud_safmr': {
          const xlsxPath = options.safmrXlsxPath ?? process.env.READVISE_SAFMR_PATH;
          if (!xlsxPath) {
            console.error('[run-stage] hud_safmr: SAFMR XLSX path required (safmrXlsxPath or READVISE_SAFMR_PATH)');
            break;
          }
          const year = options.safmrFyYear ?? DEFAULT_SAFMR_FY_YEAR;
          const { year: qYear, quarter: qQuarter } = getCurrentQuarter();
          const asOfQuarter = quarterToDate(qYear, qQuarter);
          await ingestSafmrForMarket({
            xlsxPath,
            year,
            sourceVintage: `fy${year}`,
            marketId,
            marketKey: marketKey.trim(),
            asOfQuarter,
          });
          break;
        }
        case 'snapshots': {
          const key = marketKey.trim();
          console.log('[run-stage] snapshots starting for', key);
          const asOfMonth = new Date().toISOString().slice(0, 7) + '-01';
          const snapshotResult = await buildSenseSnapshots({
            marketKey: key,
            asOfMonth,
          });
          console.log(
            '[run-stage] snapshots completed for',
            key,
            ':',
            snapshotResult.succeeded,
            'succeeded,',
            snapshotResult.failed,
            'failed',
          );
          const aggResult = await refreshAggTractMonthly(key);
          if (aggResult.error) console.error('[run-stage] snapshots aggregation failed:', aggResult.error);
          break;
        }
        case 'neighborhoods': {
          const { data: layerData, error: layerErr } = await admin
            .schema('readvise')
            .rpc('get_active_neighborhood_layer', {
              p_workspace_id: options.workspaceId!,
              p_market_key: marketKey.trim(),
            });
          if (layerErr || !layerData?.[0]?.id) {
            console.error('[run-stage] neighborhoods: no active layer', layerErr?.message);
            break;
          }
          const layerId = (layerData[0] as { id: string }).id;
          const now = new Date();
          const toMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
          const fromYear = now.getUTCFullYear() - 2;
          const fromMonth = `${fromYear}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;

          await admin.schema('readvise').rpc('sense_refresh_neighborhood_tract_weights', {
            _workspace_id: options.workspaceId!,
            _market_key: marketKey.trim(),
            _layer_id: layerId,
            _min_area_weight: 0.02,
          });
          await admin.schema('readvise').rpc('sense_refresh_neighborhood_agg_monthly', {
            _workspace_id: options.workspaceId!,
            _market_key: marketKey.trim(),
            _layer_id: layerId,
            _from_month: fromMonth,
            _to_month: toMonth,
          });
          break;
        }
      }
    } catch (err) {
      console.error(`[run-stage] ${stage} failed for ${marketKey}:`, err);
    }
  };

  run();
  return { ok: true, async: true };
}
