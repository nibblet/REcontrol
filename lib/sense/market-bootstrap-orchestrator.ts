/**
 * Market Data Bootstrap: run steps in order (validate → tracts → crosswalk → ACS → Zillow → optional snapshots/neighborhoods → publish).
 * Writes a single run record to sense_ingest_runs_market_bootstrap; hard stop on first failure.
 * Publish step always runs (even after failure) to update market availability.
 */

import fs from 'fs/promises';
import path from 'path';
import { getAdminClient } from '@/lib/supabase/admin';
import { buildMarketTracts } from './build-market-tracts';
import { refreshCrosswalkForMarket } from './zip-tract-crosswalk-ingest';
import { ingestAcsForMarket } from './acs-ingest';
import { ingestZillowZipCsv } from './zillow-ingest';
import { buildSenseSnapshots } from './sense-snapshot-builder';
import { monthRange } from './core/month';
import {
  LATEST_ACS_5YR,
  DEFAULT_ZILLOW_DATASETS,
  DEFAULT_ZILLOW_MONTHS_BACK,
  DEFAULT_SAFMR_FY_YEAR,
  STALE_RUN_TIMEOUT_MS,
} from './config';
import { ingestSafmrForMarket } from './safmr-ingest';
import { importTractGeometriesForMarket } from './import-tract-geometries';
import { refreshAggTractMonthly } from './run-stage';

export type BootstrapStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type StepStatusEntry = {
  status: BootstrapStepStatus;
  started_at?: string;
  finished_at?: string;
  error?: string;
};

export type BootstrapStepStatusMap = {
  validate?: StepStatusEntry;
  tracts?: StepStatusEntry;
  geometry?: StepStatusEntry;
  crosswalk?: StepStatusEntry;
  acs?: StepStatusEntry;
  zillow?: StepStatusEntry;
  hud_safmr?: StepStatusEntry;
  snapshots?: StepStatusEntry;
  neighborhoods?: StepStatusEntry;
  publish?: StepStatusEntry;
};

export type BootstrapCounters = {
  tract_count?: number;
  county_count?: number;
  geometry_tracts_upserted?: number;
  zip_tract_rows?: number;
  acs_tracts_ok?: number;
  acs_tracts_fail?: number;
  zillow_rows_emitted?: number;
  zillow_rows_processed?: number;
  [k: string]: number | undefined;
};

export type MarketBootstrapOptions = {
  acsYear?: number;
  runSnapshots?: boolean;
  runNeighborhoods?: boolean;
  zillowDatasets?: string[];
  zillowMonthsBack?: number;
  asOfQuarter?: string;
  safmrFyYear?: number;
  safmrXlsxPath?: string;
  /** When true, run full pipeline even if bootstrap was already completed this month (e.g. to re-run geometry). */
  force?: boolean;
};

export type MarketBootstrapResult = {
  runId: string;
  marketId: string;
  marketKey: string;
  status: 'completed' | 'failed';
  error?: string;
  step_status: BootstrapStepStatusMap;
  counters: BootstrapCounters;
  started_at: string;
  finished_at: string;
};

function datasetToCsvPath(dataset: string): string {
  return path.join(process.cwd(), 'remarket_imports', `Zip_${dataset}_month.csv`);
}

/**
 * Ensure a pipeline job exists for (market_id, source, vintage).
 * If the job already completed, returns alreadyCompleted=true so the caller can skip.
 * If it doesn't exist or previously failed, upserts to 'processing'.
 */
async function ensurePipelineJob(
  admin: ReturnType<typeof getAdminClient>,
  marketId: string,
  source: string,
  vintage: string,
): Promise<{ jobId: string; alreadyCompleted: boolean }> {
  // Check if job exists and is already completed
  const { data: existing } = await admin
    .schema('core')
    .from('sense_pipeline_jobs')
    .select('id, status')
    .eq('market_id', marketId)
    .eq('source', source)
    .eq('vintage', vintage)
    .maybeSingle();

  if (existing?.status === 'completed') {
    return { jobId: existing.id, alreadyCompleted: true };
  }

  if (existing) {
    // Re-run: update to processing
    await admin
      .schema('core')
      .from('sense_pipeline_jobs')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    return { jobId: existing.id, alreadyCompleted: false };
  }

  // New job
  const { data: newJob, error: insertErr } = await admin
    .schema('core')
    .from('sense_pipeline_jobs')
    .insert({
      market_id: marketId,
      source,
      vintage,
      status: 'processing',
    })
    .select('id')
    .single();

  if (insertErr || !newJob) {
    throw new Error(`Pipeline job insert failed: ${insertErr?.message ?? 'unknown'}`);
  }

  return { jobId: newJob.id, alreadyCompleted: false };
}

async function updatePipelineJobStatus(
  admin: ReturnType<typeof getAdminClient>,
  jobId: string,
  status: 'completed' | 'failed',
): Promise<void> {
  await admin
    .schema('core')
    .from('sense_pipeline_jobs')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

export async function runMarketBootstrap(
  workspaceId: string,
  marketKey: string,
  options: MarketBootstrapOptions = {},
): Promise<MarketBootstrapResult> {
  const admin = getAdminClient();
  if (!admin) {
    throw new Error('Supabase admin client unavailable');
  }

  if (!marketKey.match(/^cbsa:\d+$/)) {
    throw new Error('marketKey must be a CBSA market (e.g. cbsa:30460)');
  }

  const { data: marketRow, error: marketErr } = await admin
    .schema('core')
    .from('sense_markets')
    .select('id')
    .eq('market_key', marketKey)
    .maybeSingle();

  if (marketErr || !marketRow) {
    throw new Error(`Market ${marketKey} not found in sense_markets`);
  }
  const marketId = marketRow.id;

  // --- Concurrency guard ---
  const { data: activeRun, error: activeRunErr } = await admin
    .schema('core')
    .from('sense_ingest_runs_market_bootstrap')
    .select('id, started_at')
    .eq('market_id', marketId)
    .eq('status', 'processing')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeRunErr) {
    throw new Error(`Failed to check active runs: ${activeRunErr.message}`);
  }

  if (activeRun) {
    const runAge = Date.now() - new Date(activeRun.started_at).getTime();
    if (runAge > STALE_RUN_TIMEOUT_MS) {
      // Reclaim stale run
      await admin
        .schema('core')
        .from('sense_ingest_runs_market_bootstrap')
        .update({
          status: 'failed',
          error: 'Stale run reclaimed',
          finished_at: new Date().toISOString(),
        })
        .eq('id', activeRun.id);
    } else {
      throw new Error(
        `Bootstrap already in progress for market ${marketKey} (run ${activeRun.id}, started ${activeRun.started_at}). Wait for it to complete or mark it failed.`,
      );
    }
  }

  // --- Idempotency: check bootstrap job (skip when force=true so we re-run geometry etc.) ---
  const bootstrapVintage = options.force
    ? `bootstrap_force_${Date.now()}`
    : `bootstrap_${new Date().toISOString().slice(0, 7)}`;
  const bootstrapJob = await ensurePipelineJob(admin, marketId, 'bootstrap', bootstrapVintage);
  if (!options.force && bootstrapJob.alreadyCompleted) {
    console.log('[Bootstrap] Skipped (already completed this month) for marketKey=', marketKey);
    const now = new Date().toISOString();
    return {
      runId: '',
      marketId,
      marketKey,
      status: 'completed',
      step_status: {},
      counters: {},
      started_at: now,
      finished_at: now,
    };
  }

  const startedAt = new Date().toISOString();
  const stepStatus: BootstrapStepStatusMap = {};
  const counters: BootstrapCounters = {};

  const { data: runRow, error: runInsertErr } = await admin
    .schema('core')
    .from('sense_ingest_runs_market_bootstrap')
    .insert({
      market_id: marketId,
      job_id: bootstrapJob.jobId,
      run_at: startedAt,
      status: 'processing',
      step_status: stepStatus,
      counters,
      started_at: startedAt,
    })
    .select('id')
    .single();

  if (runInsertErr || !runRow) {
    throw new Error(runInsertErr?.message || 'Failed to create bootstrap run');
  }
  const runId = runRow.id;
  console.log('[Bootstrap] Pipeline started for marketKey=', marketKey, 'runId=', runId);

  const updateRun = async (updates: {
    status?: string;
    error?: string;
    step_status?: BootstrapStepStatusMap;
    counters?: BootstrapCounters;
    finished_at?: string;
  }) => {
    await admin
      .schema('core')
      .from('sense_ingest_runs_market_bootstrap')
      .update(updates)
      .eq('id', runId);
  };

  const setStep = (step: keyof BootstrapStepStatusMap, entry: StepStatusEntry) => {
    stepStatus[step] = entry;
  };

  let pipelineStatus: 'completed' | 'failed' = 'completed';
  let pipelineError: string | undefined;

  try {
    // Step 1 — Validate
    const step1Start = new Date().toISOString();
    setStep('validate', { status: 'running', started_at: step1Start });
    await updateRun({ step_status: stepStatus });

    const hudKey = process.env.HUD_API_KEY;
    const censusKey = process.env.CENSUS_API_KEY;
    if (!hudKey) {
      throw new Error('HUD_API_KEY is not set');
    }
    if (!censusKey) {
      throw new Error('CENSUS_API_KEY is not set');
    }

    setStep('validate', {
      status: 'completed',
      started_at: step1Start,
      finished_at: new Date().toISOString(),
    });
    await updateRun({ step_status: stepStatus });

    // Step 2 — Build market tracts (CBSA → tract set; only place we derive tracts from HUD)
    const step2Start = new Date().toISOString();
    setStep('tracts', { status: 'running', started_at: step2Start });
    await updateRun({ step_status: stepStatus });

    const tractsResult = await buildMarketTracts(marketKey);
    counters.tract_count = tractsResult.tractsUpserted;
    counters.county_count = tractsResult.countiesUpserted;
    setStep('tracts', {
      status: 'completed',
      started_at: step2Start,
      finished_at: new Date().toISOString(),
    });
    await updateRun({ step_status: stepStatus, counters });

    // Step 2b — Tract geometry (Census TIGER; populates sense_geo_tracts for has_geometry)
    const step2bStart = new Date().toISOString();
    console.log('[Bootstrap] Starting geometry step (import tract geometries) for marketKey=', marketKey);
    setStep('geometry', { status: 'running', started_at: step2bStart });
    await updateRun({ step_status: stepStatus });

    try {
      const geoResult = await importTractGeometriesForMarket(marketKey);
      counters.geometry_tracts_upserted = geoResult.tractsUpserted;
      setStep('geometry', {
        status: 'completed',
        started_at: step2bStart,
        finished_at: new Date().toISOString(),
      });
      console.log(
        `[Bootstrap] Geometry step completed: ${geoResult.tractsUpserted} upserted, ${geoResult.failures} failure(s)`
      );
      if (geoResult.failures > 0) {
        console.warn(
          `[Bootstrap] Geometry: ${geoResult.failures} tract(s) failed, ${geoResult.tractsUpserted} upserted`
        );
      }
    } catch (geoErr) {
      const msg = geoErr instanceof Error ? geoErr.message : 'Geometry import failed';
      console.warn(`[Bootstrap] Geometry step failed (non-blocking): ${msg}`);
      setStep('geometry', {
        status: 'failed',
        started_at: step2bStart,
        finished_at: new Date().toISOString(),
        error: msg,
      });
      // Non-blocking: continue pipeline so crosswalk/ACS/HPI still run
    }
    await updateRun({ step_status: stepStatus, counters });

    // Step 3 — ZIP→tract crosswalk (filtered to market's tracts; never derives tracts)
    const step3Start = new Date().toISOString();
    setStep('crosswalk', { status: 'running', started_at: step3Start });
    await updateRun({ step_status: stepStatus });

    const crosswalkResult = await refreshCrosswalkForMarket(marketId, {
      asOfQuarter: options.asOfQuarter,
    });
    counters.zip_tract_rows = crosswalkResult.coverage.rowsUpserted;
    setStep('crosswalk', {
      status: 'completed',
      started_at: step3Start,
      finished_at: new Date().toISOString(),
    });
    await updateRun({ step_status: stepStatus, counters });

    // Step 4 — ACS
    const step4Start = new Date().toISOString();

    // Census releases ACS 5-year with a delay; request only years that exist (e.g. 2024 released Jan 2026)
    const lastCompletedYear = new Date().getFullYear() - 1;
    const latestAcs5Year = LATEST_ACS_5YR;
    const acsYearOpt = options.acsYear;
    const acsYear = Number.isFinite(acsYearOpt)
      ? Math.min(acsYearOpt as number, lastCompletedYear, latestAcs5Year)
      : Math.min(lastCompletedYear, latestAcs5Year);

    const acsVintage = `${acsYear}_5yr`;
    const acsJob = await ensurePipelineJob(admin, marketId, 'acs', acsVintage);

    if (acsJob.alreadyCompleted) {
      setStep('acs', {
        status: 'completed',
        started_at: step4Start,
        finished_at: new Date().toISOString(),
      });
      await updateRun({ step_status: stepStatus });
    } else {
      setStep('acs', { status: 'running', started_at: step4Start });
      await updateRun({ step_status: stepStatus });

      const acsSummary = await ingestAcsForMarket({
        marketKey,
        year: acsYear,
        dryRun: false,
      });

      counters.acs_tracts_ok = acsSummary.succeeded;
      counters.acs_tracts_fail = acsSummary.failed;

      await admin.schema('core').from('sense_ingest_runs_acs').insert({
        market_id: marketId,
        job_id: acsJob.jobId,
        year: acsYear,
        vintage: acsVintage,
        status: 'completed',
        tracts_expected: acsSummary.requestedTracts,
        tracts_succeeded: acsSummary.succeeded,
        tracts_failed: acsSummary.failed,
        started_at: step4Start,
        finished_at: new Date().toISOString(),
      });

      await updatePipelineJobStatus(admin, acsJob.jobId, 'completed');

      setStep('acs', {
        status: 'completed',
        started_at: step4Start,
        finished_at: new Date().toISOString(),
      });
      await updateRun({ step_status: stepStatus, counters });
    }

    // Step 5 — Zillow
    const step5Start = new Date().toISOString();
    setStep('zillow', { status: 'running', started_at: step5Start });
    await updateRun({ step_status: stepStatus });

    const datasets =
      (options.zillowDatasets?.length ?? 0) > 0
        ? options.zillowDatasets!
        : DEFAULT_ZILLOW_DATASETS;
    const monthsBack =
      options.zillowMonthsBack ?? DEFAULT_ZILLOW_MONTHS_BACK;

    let zillowRowsEmitted = 0;
    let zillowRowsProcessed = 0;

    for (const dataset of datasets) {
      const zillowVintage = `${dataset}_${monthsBack}m`;
      const zillowJob = await ensurePipelineJob(admin, marketId, 'zillow', zillowVintage);

      if (zillowJob.alreadyCompleted) {
        continue;
      }

      const csvPath = datasetToCsvPath(dataset);
      let csvText: string;
      try {
        csvText = await fs.readFile(csvPath, 'utf-8');
      } catch {
        console.warn(
          `[Bootstrap] Zillow CSV not found: ${csvPath}, skipping dataset ${dataset}`,
        );
        await updatePipelineJobStatus(admin, zillowJob.jobId, 'failed');
        continue;
      }

      const { data: zillowRunRow, error: zillowRunErr } = await admin
        .schema('core')
        .from('sense_ingest_runs_zillow')
        .insert({
          market_id: marketId,
          job_id: zillowJob.jobId,
          dataset,
          months_back: monthsBack,
          status: 'processing',
          started_at: step5Start,
        })
        .select('id')
        .single();

      if (zillowRunErr || !zillowRunRow) {
        throw new Error(
          zillowRunErr?.message ?? 'Failed to create Zillow ingest run',
        );
      }

      const summary = await ingestZillowZipCsv({
        csvText,
        dataset,
        monthsBack,
        marketId,
      });

      zillowRowsEmitted += summary.rowsEmitted;
      zillowRowsProcessed += summary.rowsProcessed;

      await admin
        .schema('core')
        .from('sense_ingest_runs_zillow')
        .update({
          status: 'completed',
          rows_processed: summary.rowsProcessed,
          rows_emitted: summary.rowsEmitted,
          filtered_zip_count: summary.filteredZipCount,
          invalid_zip_count: summary.invalidZipCount,
          finished_at: new Date().toISOString(),
        })
        .eq('id', zillowRunRow.id);

      await updatePipelineJobStatus(admin, zillowJob.jobId, 'completed');
    }

    counters.zillow_rows_emitted = zillowRowsEmitted;
    counters.zillow_rows_processed = zillowRowsProcessed;
    setStep('zillow', {
      status: 'completed',
      started_at: step5Start,
      finished_at: new Date().toISOString(),
    });
    await updateRun({ step_status: stepStatus, counters });

    // Step 5b — HUD SAFMR (non-blocking enrichment; path from options or READVISE_SAFMR_PATH)
    const safmrFyYear = options.safmrFyYear ?? DEFAULT_SAFMR_FY_YEAR;
    const safmrVintage = `fy${safmrFyYear}`;
    const safmrXlsxPath = options.safmrXlsxPath ?? process.env.READVISE_SAFMR_PATH;

    if (!safmrXlsxPath) {
      const step5bStart = new Date().toISOString();
      setStep('hud_safmr', {
        status: 'skipped',
        started_at: step5bStart,
        finished_at: step5bStart,
        error: 'No SAFMR path (use Import SAFMR in REcontrol or set READVISE_SAFMR_PATH)',
      });
      await updateRun({ step_status: stepStatus });
    } else if (safmrXlsxPath) {
      const safmrStart = new Date().toISOString();
      setStep('hud_safmr', { status: 'running', started_at: safmrStart });
      await updateRun({ step_status: stepStatus });

      const safmrJob = await ensurePipelineJob(admin, marketId, 'hud_safmr', safmrVintage);

      if (safmrJob.alreadyCompleted) {
        setStep('hud_safmr', {
          status: 'completed',
          started_at: safmrStart,
          finished_at: new Date().toISOString(),
        });
        await updateRun({ step_status: stepStatus });
      } else {
        try {
          const asOfQuarter = options.asOfQuarter ?? new Date().toISOString().slice(0, 10);
          const safmrResult = await ingestSafmrForMarket({
            xlsxPath: safmrXlsxPath,
            year: safmrFyYear,
            sourceVintage: safmrVintage,
            marketId,
            marketKey,
            asOfQuarter,
          });

          counters.safmr_rows_ingested = safmrResult.rowsIngested;
          counters.safmr_tracts_projected = safmrResult.tractsProjected;

          await updatePipelineJobStatus(admin, safmrJob.jobId, 'completed');
          setStep('hud_safmr', {
            status: 'completed',
            started_at: safmrStart,
            finished_at: new Date().toISOString(),
          });
        } catch (safmrErr) {
          const msg = safmrErr instanceof Error ? safmrErr.message : 'SAFMR ingest failed';
          console.warn(`[Bootstrap] SAFMR step failed (non-blocking): ${msg}`);
          await updatePipelineJobStatus(admin, safmrJob.jobId, 'failed');
          setStep('hud_safmr', {
            status: 'failed',
            started_at: safmrStart,
            finished_at: new Date().toISOString(),
            error: msg,
          });
          // Non-blocking: do NOT throw; continue pipeline
        }
        await updateRun({ step_status: stepStatus, counters });
      }
    }

    // Step 6 — Optional snapshots + neighborhoods (snapshots are market-level; no workspace required)
    if (options.runSnapshots) {
      const step6Start = new Date().toISOString();
      console.log('[Bootstrap] Snapshots step starting for', marketKey);
      setStep('snapshots', { status: 'running', started_at: step6Start });
      await updateRun({ step_status: stepStatus });

      try {
        const snapshotResult = await buildSenseSnapshots({
          marketKey,
          asOfMonth: new Date().toISOString().slice(0, 7) + '-01',
        });
        console.log(
          '[Bootstrap] Snapshots step completed:',
          snapshotResult.succeeded,
          'succeeded,',
          snapshotResult.failed,
          'failed for',
          marketKey,
        );
        const aggResult = await refreshAggTractMonthly(marketKey);
        if (aggResult.error) {
          console.warn('[Bootstrap] snapshots: agg refresh failed:', aggResult.error);
        }
        setStep('snapshots', {
          status: 'completed',
          started_at: step6Start,
          finished_at: new Date().toISOString(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Snapshots failed';
        setStep('snapshots', {
          status: 'failed',
          started_at: step6Start,
          finished_at: new Date().toISOString(),
          error: msg,
        });
        await updateRun({ step_status: stepStatus });
        throw err;
      }
      await updateRun({ step_status: stepStatus });
    }

    if (options.runNeighborhoods) {
      const step7Start = new Date().toISOString();
      setStep('neighborhoods', { status: 'running', started_at: step7Start });
      await updateRun({ step_status: stepStatus });

      try {
        const { data: layerData, error: layerErr } = await admin
          .schema('readvise')
          .rpc('get_active_neighborhood_layer', {
            p_workspace_id: workspaceId,
            p_market_key: marketKey,
          });
        if (layerErr || !layerData?.[0]?.id) {
          throw new Error('No active neighborhood layer found');
        }
        const layerId = layerData[0].id;

        await admin.schema('readvise').rpc('sense_refresh_neighborhood_tract_weights', {
          _workspace_id: workspaceId,
          _market_key: marketKey,
          _layer_id: layerId,
          _min_area_weight: 0.02,
        });

        const now = new Date();
        const toMonthStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
        const { fromMonth: fromMonthStr } = monthRange(toMonthStr, 24);

        await admin.schema('readvise').rpc('sense_refresh_neighborhood_agg_monthly', {
          _workspace_id: workspaceId,
          _market_key: marketKey,
          _layer_id: layerId,
          _from_month: fromMonthStr,
          _to_month: toMonthStr,
        });

        setStep('neighborhoods', {
          status: 'completed',
          started_at: step7Start,
          finished_at: new Date().toISOString(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Neighborhood refresh failed';
        setStep('neighborhoods', {
          status: 'failed',
          started_at: step7Start,
          finished_at: new Date().toISOString(),
          error: msg,
        });
        await updateRun({ step_status: stepStatus });
        throw err;
      }
      await updateRun({ step_status: stepStatus });
    }

    const finishedAt = new Date().toISOString();
    await updateRun({
      status: 'completed',
      step_status: stepStatus,
      counters,
      finished_at: finishedAt,
    });

    await updatePipelineJobStatus(admin, bootstrapJob.jobId, 'completed');
    pipelineStatus = 'completed';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bootstrap failed';
    pipelineError = message;
    pipelineStatus = 'failed';
    const finishedAt = new Date().toISOString();
    await updateRun({
      status: 'failed',
      error: message,
      step_status: stepStatus,
      counters,
      finished_at: finishedAt,
    });
    await updatePipelineJobStatus(admin, bootstrapJob.jobId, 'failed');
  } finally {
    // --- Publish step: always runs to update market availability ---
    await runPublishStep(admin, marketId, stepStatus, updateRun);

    // --- Emit pipeline event (fire-and-forget) ---
    try {
      const eventType =
        pipelineStatus === 'completed'
          ? 'market.bootstrap.completed'
          : 'market.bootstrap.failed';

      const payload: Record<string, unknown> = { market_key: marketKey };
      if (pipelineStatus === 'failed') {
        const failedStep = Object.entries(stepStatus).find(
          ([, v]) => v?.status === 'failed',
        );
        payload.failed_step = failedStep?.[0] ?? 'unknown';
        payload.error_summary = pipelineError?.slice(0, 500);
      } else {
        payload.counters = counters;
      }

      await admin
        .schema('core')
        .from('sense_pipeline_events')
        .insert({
          event_type: eventType,
          market_id: marketId,
          run_id: runId,
          payload,
        });
    } catch (evtErr) {
      console.error('[Bootstrap] Failed to emit pipeline event:', evtErr);
    }
  }

  return {
    runId,
    marketId,
    marketKey,
    status: pipelineStatus,
    error: pipelineError,
    step_status: stepStatus,
    counters,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  };
}

/**
 * Publish step: validate market readiness via RPC and upsert sense_market_availability.
 * Wrapped in its own try/catch so it never prevents the function from returning.
 */
async function runPublishStep(
  admin: ReturnType<typeof getAdminClient>,
  marketId: string,
  stepStatus: BootstrapStepStatusMap,
  updateRun: (updates: { step_status?: BootstrapStepStatusMap }) => Promise<void>,
): Promise<void> {
  const publishStart = new Date().toISOString();
  stepStatus.publish = { status: 'running', started_at: publishStart };

  try {
    const { data: readiness, error: readinessErr } = await admin
      .schema('readvise')
      .rpc('validate_market_readiness', { _market_id: marketId });

    if (readinessErr) {
      throw new Error(readinessErr.message);
    }

    const r = readiness as {
      status: string;
      has_tracts: boolean;
      has_geometry: boolean;
      has_projections: boolean;
      has_hpi: boolean;
      has_neighborhoods: boolean;
      has_safmr: boolean;
    };

    const { error: upsertErr } = await admin
      .schema('core')
      .from('sense_market_availability')
      .upsert(
        {
          market_id: marketId,
          status: r.status,
          has_tracts: r.has_tracts,
          has_geometry: r.has_geometry,
          has_projections: r.has_projections,
          has_hpi: r.has_hpi,
          has_neighborhoods: r.has_neighborhoods,
          has_safmr: r.has_safmr,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'market_id' },
      );

    if (upsertErr) {
      throw new Error(upsertErr.message);
    }

    stepStatus.publish = {
      status: 'completed',
      started_at: publishStart,
      finished_at: new Date().toISOString(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Publish failed';
    stepStatus.publish = {
      status: 'failed',
      started_at: publishStart,
      finished_at: new Date().toISOString(),
      error: msg,
    };
    console.error('[Bootstrap] Publish step failed:', msg);
  }

  try {
    await updateRun({ step_status: stepStatus });
  } catch {
    // Best-effort update; don't mask the original error
  }
}
