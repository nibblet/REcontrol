/**
 * Service job to import tract geometries for a market
 *
 * Populates core.sense_geo_tracts for all tracts in sense_market_tracts for a market.
 * This job is idempotent - it can be run multiple times safely.
 * Uses Supabase RPC (upsert_sense_geo_tracts_batch) for upserts; no direct pg required.
 */

import { getAdminClient } from '@/lib/supabase/admin';
import {
  TractGeometryProvider,
  defaultTractGeometryProvider,
  type MultiPolygon,
} from './tract-geometry-provider';

export type TractGeometryImportResult = {
  marketKey: string;
  marketId: string;
  tractsNeeded: number;
  tractsFetched: number;
  tractsUpserted: number;
  failures: number;
  errors: string[];
};

const BATCH_SIZE = 50;
const DB_BATCH_SIZE = 100;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function validateGeometry(geom: MultiPolygon): {
  valid: boolean;
  error?: string;
} {
  if (!geom || geom.type !== 'MultiPolygon') {
    return {
      valid: false,
      error: `Expected MultiPolygon, got ${(geom as { type?: string })?.type || 'null'}`,
    };
  }

  if (!Array.isArray(geom.coordinates)) {
    return { valid: false, error: 'Missing coordinates array' };
  }

  for (const polygon of geom.coordinates) {
    if (!Array.isArray(polygon)) {
      return { valid: false, error: 'Invalid polygon structure' };
    }
    for (const ring of polygon) {
      if (!Array.isArray(ring)) {
        return { valid: false, error: 'Invalid ring structure' };
      }
      for (const coord of ring) {
        if (!Array.isArray(coord) || coord.length < 2) {
          return { valid: false, error: 'Invalid coordinate structure' };
        }
        const [lng, lat] = coord;
        if (typeof lng !== 'number' || typeof lat !== 'number') {
          return { valid: false, error: 'Invalid coordinate values' };
        }
        if (lng < -180 || lng > 180) {
          return { valid: false, error: 'Longitude out of range' };
        }
        if (lat < -90 || lat > 90) {
          return { valid: false, error: 'Latitude out of range' };
        }
      }
    }
  }

  return { valid: true };
}

type GeometryRow = {
  tract_id: string;
  geom: MultiPolygon;
  source: string;
  vintage: number | null;
};

async function upsertTractGeometriesViaRpc(
  admin: ReturnType<typeof getAdminClient>,
  rows: GeometryRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  let upserted = 0;
  const pRowsFormat = rows.map((row) => ({
    tract_id: row.tract_id,
    geom_geojson: JSON.stringify(row.geom),
    source: row.source,
    vintage: row.vintage,
  }));

  for (const batch of chunkArray(pRowsFormat, DB_BATCH_SIZE)) {
    const { data, error } = await admin
      .schema('core')
      .rpc('upsert_sense_geo_tracts_batch', { p_rows: batch });

    if (error) {
      console.error('[ImportTractGeometries] RPC upsert batch failed:', error.message);
      throw error;
    }
    upserted += typeof data === 'number' ? data : 0;
  }

  return upserted;
}

/**
 * Import tract geometries for a market
 */
export async function importTractGeometriesForMarket(
  marketKey: string,
  provider: TractGeometryProvider = defaultTractGeometryProvider,
): Promise<TractGeometryImportResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required to import tract geometries (RLS is enabled on shared tables).',
    );
  }

  const admin = getAdminClient();
  const result: TractGeometryImportResult = {
    marketKey,
    marketId: '',
    tractsNeeded: 0,
    tractsFetched: 0,
    tractsUpserted: 0,
    failures: 0,
    errors: [],
  };

  const { data: market, error: marketError } = await admin
    .schema('core')
    .from('sense_markets')
    .select('id, market_key')
    .eq('market_key', marketKey)
    .single();

  if (marketError || !market) {
    throw new Error(
      `Market not found for key "${marketKey}": ${marketError?.message || 'missing record'}`,
    );
  }

  result.marketId = market.id;

  const { data: marketTracts, error: tractsError } = await admin
    .schema('core')
    .from('sense_market_tracts')
    .select('tract_id')
    .eq('market_id', market.id)
    .eq('active', true);

  if (tractsError) {
    throw new Error(
      `Failed to load sense_market_tracts for market ${market.id}: ${tractsError.message}`,
    );
  }

  if (!marketTracts || marketTracts.length === 0) {
    return result;
  }

  const tractIds = marketTracts
    .map((row) => row.tract_id)
    .filter((id): id is string => Boolean(id));
  result.tractsNeeded = tractIds.length;

  const { data: existingGeoms, error: existingError } = await admin
    .schema('core')
    .from('sense_geo_tracts')
    .select('tract_id')
    .in('tract_id', tractIds);

  if (existingError) {
    console.warn(`[ImportTractGeometries] Failed to check existing geometries: ${existingError.message}`);
  }

  const existingTractIds = new Set((existingGeoms || []).map((row) => row.tract_id));
  const tractsToFetch = tractIds.filter((id) => !existingTractIds.has(id));

  const geometriesToUpsert: GeometryRow[] = [];
  const batches = chunkArray(tractsToFetch, BATCH_SIZE);

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const fetchPromises = batch.map(async (tractId) => {
      try {
        const geom = await provider.getTractGeometry(tractId);
        if (!geom) {
          result.failures += 1;
          result.errors.push(`Failed to fetch geometry for tract ${tractId}`);
          return null;
        }
        const validation = validateGeometry(geom);
        if (!validation.valid) {
          result.failures += 1;
          result.errors.push(`Invalid geometry for tract ${tractId}: ${validation.error}`);
          return null;
        }
        result.tractsFetched += 1;
        return {
          tract_id: tractId,
          geom,
          source: 'tiger_line',
          vintage: 2022,
        } as GeometryRow;
      } catch (error) {
        result.failures += 1;
        result.errors.push(
          `Error fetching tract ${tractId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        return null;
      }
    });

    const fetched = await Promise.all(fetchPromises);
    const valid = fetched.filter((item): item is GeometryRow => item !== null);
    geometriesToUpsert.push(...valid);

    if (i < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (geometriesToUpsert.length > 0) {
    result.tractsUpserted = await upsertTractGeometriesViaRpc(admin, geometriesToUpsert);
  }

  return result;
}
