/**
 * Monthly snapshot job: run buildSenseSnapshots + refreshAggTractMonthly for each enabled market.
 * Called by REcontrol (super admin) via server action or cron route. Snapshots are market-level.
 */

import { getAdminClient } from '@/lib/supabase/admin';
import { buildSenseSnapshots } from './sense-snapshot-builder';
import { refreshAggTractMonthly } from './run-stage';

export type RunMonthlySnapshotsResult = {
  ok: boolean;
  marketsProcessed: number;
  errors: Array<{ marketKey: string; error: string }>;
};

/**
 * List enabled markets from core.sense_markets and run snapshots + agg refresh for each.
 * Runs sequentially to avoid overload. Use for monthly cron or manual "Run monthly snapshots" button.
 */
export async function runMonthlySnapshotsJob(): Promise<RunMonthlySnapshotsResult> {
  const admin = getAdminClient();
  if (!admin) {
    return { ok: false, marketsProcessed: 0, errors: [{ marketKey: '', error: 'Admin client unavailable' }] };
  }

  const asOfMonth = new Date().toISOString().slice(0, 7) + '-01';

  const { data: markets, error: listErr } = await admin
    .schema('core')
    .from('sense_markets')
    .select('market_key')
    .eq('enabled', true);

  if (listErr) {
    console.error('[run-monthly-snapshots] list markets failed:', listErr.message);
    return { ok: false, marketsProcessed: 0, errors: [{ marketKey: '', error: listErr.message }] };
  }

  const marketKeys = (markets ?? [])
    .map((r: { market_key?: string | null }) => r.market_key)
    .filter((k): k is string => Boolean(k));

  const errors: Array<{ marketKey: string; error: string }> = [];
  let processed = 0;

  for (const marketKey of marketKeys) {
    try {
      await buildSenseSnapshots({ marketKey, asOfMonth });
      const aggResult = await refreshAggTractMonthly(marketKey);
      if (aggResult.error) {
        console.warn(`[run-monthly-snapshots] ${marketKey} agg refresh:`, aggResult.error);
      }
      processed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[run-monthly-snapshots] ${marketKey}:`, msg);
      errors.push({ marketKey, error: msg });
    }
  }

  return {
    ok: errors.length === 0,
    marketsProcessed: processed,
    errors,
  };
}
