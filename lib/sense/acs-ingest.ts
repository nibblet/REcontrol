import { getAdminClient } from '@/lib/supabase/admin';

const ACS_BASE_URL = 'https://api.census.gov/data';
const ACS_SURVEY = 'acs/acs5';
const ACS_SOURCE = 'ACS_5YR';
const ACS_PIPELINE_VERSION = 'sense_acs_ingest_v1';

const ACS_VARIABLES = [
  'B01003_001E', 'B25001_001E', 'B25002_002E', 'B25002_003E', 'B25003_002E', 'B25003_003E',
  'B19013_001E', 'B17001_001E', 'B17001_002E', 'B25034_001E', 'B25034_002E', 'B25034_003E',
  'B25034_004E', 'B25034_005E', 'B25034_006E', 'B25034_007E', 'B25034_008E', 'B25034_009E',
  'B25034_010E', 'B25034_011E', 'B25024_001E', 'B25024_002E', 'B25024_003E', 'B25024_004E',
  'B25024_005E', 'B25024_006E', 'B25024_007E', 'B25024_008E', 'B25024_009E', 'B25024_010E', 'B25024_011E',
];

const REQUIRED_VARIABLES = new Set(ACS_VARIABLES);
const ACS_BATCH_UPSERT_SIZE = 200;
const ACS_RATE_LIMIT_DELAY_MS = 400;
const RETRY_LIMIT = 3;

type AcsIngestParams = {
  marketKey?: string;
  year: number;
  vintage?: string;
  dryRun?: boolean;
  limit?: number;
  onlyMissing?: boolean;
};

type AcsIngestSummary = {
  marketKey: string | null;
  year: number;
  vintage: string;
  totalTracts: number;
  requestedTracts: number;
  succeeded: number;
  failed: number;
  missingVarsCount: number;
  apiCalls: number;
  durationMs: number;
  failureSamples: Array<{ tractId: string; reason: string }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const parseAcsNumber = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildRawMetrics = (record: Record<string, string>) => {
  const raw: Record<string, number | null> = {};
  ACS_VARIABLES.forEach((variable) => {
    raw[variable] = parseAcsNumber(record[variable]);
  });
  return raw;
};

const pctOf = (count: number | null, total: number | null) => {
  if (total === null || total === 0) return null;
  if (count === null) return null;
  return count / total;
};

const ensurePctRange = (label: string, value: number | null, warnings: string[]) => {
  if (value === null) return null;
  if (value < 0 || value > 1) {
    warnings.push(`pct_out_of_range:${label}`);
    return null;
  }
  return value;
};

const buildBucket = (
  label: string,
  count: number | null,
  total: number | null,
  warnings: string[],
) => {
  const pct = ensurePctRange(label, pctOf(count, total), warnings);
  return { count, pct };
};

const computeMetrics = (record: Record<string, string>, year: number, vintage: string) => {
  const warnings: string[] = [];
  const raw = buildRawMetrics(record);
  const missingVars = Object.entries(raw)
    .filter(([, value]) => value === null)
    .map(([variable]) => variable)
    .filter((variable) => REQUIRED_VARIABLES.has(variable));
  if (missingVars.length > 0) warnings.push(`missing_vars:${missingVars.join(',')}`);

  let normalizedIncome = raw.B19013_001E;
  if (normalizedIncome !== null && (normalizedIncome <= 0 || normalizedIncome === -666666666)) {
    warnings.push('acs_income_missing');
    normalizedIncome = null;
  }

  const housingUnits = raw.B25001_001E ?? null;
  const occupiedUnits = raw.B25002_002E ?? null;
  const vacantUnits = raw.B25002_003E ?? null;
  const ownerOccupiedUnits = raw.B25003_002E ?? null;
  const renterOccupiedUnits = raw.B25003_003E ?? null;

  const vacancyRate = ensurePctRange('vacancy_rate', pctOf(vacantUnits, housingUnits), warnings);
  if (housingUnits === 0) warnings.push('zero_denominator:housing_units');

  const ownerOccupiedRate = ensurePctRange('owner_occupied_rate', pctOf(ownerOccupiedUnits, occupiedUnits), warnings);
  if (occupiedUnits === 0) warnings.push('zero_denominator:occupied_units');

  const povertyRate = ensurePctRange('poverty_rate', pctOf(raw.B17001_002E ?? null, raw.B17001_001E ?? null), warnings);
  if (raw.B17001_001E === 0) warnings.push('zero_denominator:poverty_universe');

  const yearBuiltTotals = {
    pre1960: (raw.B25034_009E ?? 0) + (raw.B25034_010E ?? 0) + (raw.B25034_011E ?? 0),
    y1960_1979: (raw.B25034_008E ?? 0) + (raw.B25034_007E ?? 0),
    y1980_1999: (raw.B25034_006E ?? 0) + (raw.B25034_005E ?? 0),
    y2000_plus: (raw.B25034_004E ?? 0) + (raw.B25034_003E ?? 0) + (raw.B25034_002E ?? 0),
  };

  const unitsStructureTotals = {
    singleDetached: raw.B25024_002E ?? 0,
    smallMulti: (raw.B25024_003E ?? 0) + (raw.B25024_004E ?? 0) + (raw.B25024_005E ?? 0),
    multi5Plus: (raw.B25024_006E ?? 0) + (raw.B25024_007E ?? 0) + (raw.B25024_008E ?? 0) + (raw.B25024_009E ?? 0),
    mobileOther: (raw.B25024_010E ?? 0) + (raw.B25024_011E ?? 0),
  };

  const metrics = {
    meta: { source: ACS_SOURCE, year, vintage, vars: ACS_VARIABLES, generated_at: new Date().toISOString(), pipeline_version: ACS_PIPELINE_VERSION },
    warnings,
    raw,
    population: raw.B01003_001E ?? null,
    housing_units: housingUnits,
    occupied_units: occupiedUnits,
    vacant_units: vacantUnits,
    vacancy_rate: vacancyRate,
    owner_occupied_units: ownerOccupiedUnits,
    renter_occupied_units: renterOccupiedUnits,
    owner_occupied_rate: ownerOccupiedRate,
    median_household_income: normalizedIncome,
    poverty_rate: povertyRate,
    housing_stock: {
      year_built_buckets: {
        pre_1960: buildBucket('year_built_pre_1960', yearBuiltTotals.pre1960, housingUnits, warnings),
        '1960_1979': buildBucket('year_built_1960_1979', yearBuiltTotals.y1960_1979, housingUnits, warnings),
        '1980_1999': buildBucket('year_built_1980_1999', yearBuiltTotals.y1980_1999, housingUnits, warnings),
        '2000_plus': buildBucket('year_built_2000_plus', yearBuiltTotals.y2000_plus, housingUnits, warnings),
      },
      units_in_structure_buckets: {
        single_detached: buildBucket('units_single_detached', unitsStructureTotals.singleDetached, housingUnits, warnings),
        small_multi_2_4: buildBucket('units_small_multi_2_4', unitsStructureTotals.smallMulti, housingUnits, warnings),
        multi_5_plus: buildBucket('units_multi_5_plus', unitsStructureTotals.multi5Plus, housingUnits, warnings),
        mobile_other: buildBucket('units_mobile_other', unitsStructureTotals.mobileOther, housingUnits, warnings),
      },
    },
  };

  const yearBuiltPctSum =
    (metrics.housing_stock.year_built_buckets.pre_1960.pct ?? 0) +
    (metrics.housing_stock.year_built_buckets['1960_1979'].pct ?? 0) +
    (metrics.housing_stock.year_built_buckets['1980_1999'].pct ?? 0) +
    (metrics.housing_stock.year_built_buckets['2000_plus'].pct ?? 0);
  if (yearBuiltPctSum > 1.02 || (yearBuiltPctSum > 0 && yearBuiltPctSum < 0.98)) warnings.push('bucket_pct_sum:year_built');

  const unitsPctSum =
    (metrics.housing_stock.units_in_structure_buckets.single_detached.pct ?? 0) +
    (metrics.housing_stock.units_in_structure_buckets.small_multi_2_4.pct ?? 0) +
    (metrics.housing_stock.units_in_structure_buckets.multi_5_plus.pct ?? 0) +
    (metrics.housing_stock.units_in_structure_buckets.mobile_other.pct ?? 0);
  if (unitsPctSum > 1.02 || (unitsPctSum > 0 && unitsPctSum < 0.98)) warnings.push('bucket_pct_sum:units_in_structure');

  return { metrics, missingVars };
};

const fetchAcsTractsForCounty = async (
  stateFips: string,
  countyFips: string,
  year: number,
  apiKey: string,
  attempt = 1,
): Promise<Array<Record<string, string>>> => {
  const params = new URLSearchParams();
  params.set('get', ACS_VARIABLES.join(','));
  params.set('for', 'tract:*');
  params.set('in', `state:${stateFips} county:${countyFips}`);
  params.set('key', apiKey);
  const url = `${ACS_BASE_URL}/${year}/${ACS_SURVEY}?${params.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'recontrol-sense-acs-ingest/1.0' },
  });
  if (!response.ok) {
    if (response.status === 429 && attempt <= RETRY_LIMIT) {
      await sleep(500 * attempt);
      return fetchAcsTractsForCounty(stateFips, countyFips, year, apiKey, attempt + 1);
    }
    const body = await response.text();
    throw new Error(`ACS request failed (${response.status}) for ${stateFips}${countyFips}: ${body || response.statusText}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length < 2) throw new Error(`ACS payload missing rows for ${stateFips}${countyFips}`);
  const [header, ...rows] = payload as [string[], ...string[][]];
  return rows.map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => { record[key] = row[index]; });
    return record;
  });
};

const loadMarketTracts = async (marketKey: string) => {
  const admin = getAdminClient();
  const { data: market, error: marketError } = await admin.schema('core').from('sense_markets').select('id, market_key').eq('market_key', marketKey).single();
  if (marketError || !market) throw new Error(`Market not found for key "${marketKey}": ${marketError?.message || 'missing record'}`);
  const { data: tracts, error: tractsError } = await admin.schema('core').from('sense_market_tracts').select('tract_id').eq('market_id', market.id).eq('active', true);
  if (tractsError) throw new Error(`Failed to load sense_market_tracts for market ${market.id}: ${tractsError.message}`);
  const tractIds = (tracts || []).map((row: { tract_id: string | null }) => row.tract_id).filter((tractId): tractId is string => Boolean(tractId));
  return { marketId: market.id, tractIds };
};

const loadAllTracts = async () => {
  const admin = getAdminClient();
  const { data, error } = await admin.schema('core').from('sense_market_tracts').select('tract_id').eq('active', true);
  if (error) throw new Error(`Failed to load sense_market_tracts: ${error.message}`);
  const tractIds = (data || []).map((row: { tract_id: string | null }) => row.tract_id).filter((tractId): tractId is string => Boolean(tractId));
  return { tractIds };
};

const loadExistingTracts = async (tractIds: string[], year: number) => {
  const admin = getAdminClient();
  const existing = new Set<string>();
  for (const chunk of chunkArray(tractIds, 500)) {
    const { data, error } = await admin.schema('core').from('sense_src_acs_tract_yearly').select('tract_id').eq('year', year).in('tract_id', chunk);
    if (error) throw new Error(`Failed to load existing ACS rows: ${error.message}`);
    data?.forEach((row: { tract_id: string | null }) => { if (row.tract_id) existing.add(row.tract_id); });
  }
  return existing;
};

export async function ingestAcsForMarket(params: AcsIngestParams): Promise<AcsIngestSummary> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to ingest ACS data (RLS is enabled).');
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) throw new Error('CENSUS_API_KEY is required for ACS ingestion.');

  const { marketKey, year, dryRun = false, onlyMissing = false } = params;
  const vintage = params.vintage || `${year}_5yr`;
  const startTime = Date.now();
  const admin = getAdminClient();

  const tractIds = marketKey ? (await loadMarketTracts(marketKey)).tractIds : (await loadAllTracts()).tractIds;
  let targetTracts = [...tractIds];
  if (onlyMissing) {
    const existing = await loadExistingTracts(targetTracts, year);
    targetTracts = targetTracts.filter((tractId) => !existing.has(tractId));
  }
  if (params.limit && params.limit > 0) targetTracts = targetTracts.slice(0, params.limit);

  const targetSet = new Set(targetTracts);
  const totalTracts = tractIds.length;
  const requestedTracts = targetTracts.length;

  const countyGroups = new Map<string, string[]>();
  for (const tractId of targetTracts) {
    const state = tractId.slice(0, 2);
    const county = tractId.slice(2, 5);
    const key = `${state}-${county}`;
    if (!countyGroups.has(key)) countyGroups.set(key, []);
    countyGroups.get(key)!.push(tractId);
  }

  let succeeded = 0;
  let failed = 0;
  let missingVarsCount = 0;
  let apiCalls = 0;
  const failureSamples: Array<{ tractId: string; reason: string }> = [];

  for (const [key] of countyGroups) {
    const [state, county] = key.split('-');
    if (!state || !county) continue;

    const records = await fetchAcsTractsForCounty(state, county, year, apiKey);
    apiCalls += 1;

    const rowsToUpsert: Array<{ tract_id: string; year: number; metrics: Record<string, unknown>; ingested_at: string }> = [];

    for (const record of records) {
      const tractId = `${record.state}${record.county}${record.tract}`;
      if (!targetSet.has(tractId)) continue;

      const { metrics, missingVars } = computeMetrics(record, year, vintage);
      if (missingVars.length > 0) {
        missingVarsCount += 1;
        failed += 1;
        if (failureSamples.length < 10) failureSamples.push({ tractId, reason: `Missing vars: ${missingVars.join(',')}` });
        continue;
      }

      rowsToUpsert.push({ tract_id: tractId, year, metrics, ingested_at: new Date().toISOString() });
      succeeded += 1;
    }

    if (!dryRun && rowsToUpsert.length > 0) {
      for (const chunk of chunkArray(rowsToUpsert, ACS_BATCH_UPSERT_SIZE)) {
        const { error } = await admin.schema('core').from('sense_src_acs_tract_yearly').upsert(chunk, { onConflict: 'tract_id,year' });
        if (error) throw new Error(`Failed to upsert ACS metrics: ${error.message}`);
      }
    }
    await sleep(ACS_RATE_LIMIT_DELAY_MS);
  }

  return {
    marketKey: marketKey ?? null,
    year,
    vintage,
    totalTracts,
    requestedTracts,
    succeeded,
    failed,
    missingVarsCount,
    apiCalls,
    durationMs: Date.now() - startTime,
    failureSamples,
  };
}

export { ACS_VARIABLES, ACS_PIPELINE_VERSION };
