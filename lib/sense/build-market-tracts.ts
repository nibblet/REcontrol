/**
 * Step A: Build/refresh market tract set for a CBSA.
 * Tracts come from Census API (counties in CBSA + tracts per county). HUD is used only for ZIP→tract crosswalk later.
 * Idempotent: upsert sense_market_tracts and sense_market_counties (no mass deactivation).
 */

import { getAdminClient } from '@/lib/supabase/admin';
import { fetchTractIdsForCbsa } from './census-cbsa-tracts';

const CHUNK_SIZE = 500;

export type BuildMarketTractsResult = {
  marketId: string;
  marketKey: string;
  cbsaCode: string;
  tractsUpserted: number;
  countiesUpserted: number;
  source: 'census';
};

/**
 * Build or refresh the tract set for a CBSA market from the Census API (counties in CBSA, then tracts per county).
 * Upserts sense_market_tracts and sense_market_counties. Does not run crosswalk or ACS.
 */
export async function buildMarketTracts(marketKey: string): Promise<BuildMarketTractsResult> {
  const admin = getAdminClient();

  const cbsaMatch = marketKey.match(/^cbsa:(\d+)$/);
  if (!cbsaMatch) {
    throw new Error('marketKey must be a CBSA market (e.g. cbsa:30460)');
  }
  const cbsaCode = cbsaMatch[1];

  const censusKey = process.env.CENSUS_API_KEY;
  if (!censusKey) {
    throw new Error(
      'CENSUS_API_KEY is not set. Add it to .env.local to build market tracts from the Census API.',
    );
  }

  const { data: marketRow, error: marketErr } = await admin
    .schema('core')
    .from('sense_markets')
    .select('id')
    .eq('market_key', marketKey)
    .maybeSingle();

  if (marketErr || !marketRow) {
    throw new Error(`Market ${marketKey} not found in sense_markets.`);
  }
  const marketId = marketRow.id;

  const { tractIds: tractIdsArr, countyGeoids } = await fetchTractIdsForCbsa(
    cbsaCode,
    censusKey,
  );

  if (tractIdsArr.length === 0) {
    throw new Error(
      `No tracts returned for CBSA ${cbsaCode}. Census returned ${countyGeoids.length} counties. Check CENSUS_API_KEY and CBSA code (e.g. 30460 for Lexington).`,
    );
  }

  for (let i = 0; i < tractIdsArr.length; i += CHUNK_SIZE) {
    const chunk = tractIdsArr
      .slice(i, i + CHUNK_SIZE)
      .map((tract_id) => ({ market_id: marketId, tract_id, active: true }));
    const { error } = await admin
      .schema('core')
      .from('sense_market_tracts')
      .upsert(chunk, { onConflict: 'market_id,tract_id' });
    if (error) throw new Error(`sense_market_tracts: ${error.message}`);
  }

  if (countyGeoids.length > 0) {
    const countyRows = countyGeoids.map((county_geoid) => ({
      market_id: marketId,
      county_geoid,
    }));
    const { error: countyErr } = await admin
      .schema('core')
      .from('sense_market_counties')
      .upsert(countyRows, { onConflict: 'market_id,county_geoid' });
    if (countyErr) throw new Error(`sense_market_counties: ${countyErr.message}`);
  }

  return {
    marketId,
    marketKey,
    cbsaCode,
    tractsUpserted: tractIdsArr.length,
    countiesUpserted: countyGeoids.length,
    source: 'census',
  };
}
