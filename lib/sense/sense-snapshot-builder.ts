import { getAdminClient } from '@/lib/supabase/admin';

export const SNAPSHOT_ENGINE_VERSION = 'sense_snapshot_v1';
const DEFAULT_ACS_YEAR = 2023;
const HISTORY_MONTHS = 24;
const VOLATILITY_MONTHS = 6;

const VOLATILITY_LOW = 0.01;
const VOLATILITY_MEDIUM = 0.03;

const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

// Neighborhood coherence thresholds (Item 4)
const COHERENCE_HIGH_THRESHOLD = 6; // stddev <= 6 => high
const COHERENCE_MEDIUM_THRESHOLD = 14; // 6 < stddev <= 14 => medium, >14 => low

type SenseSnapshotParams = {
  /** Omitted for market-level snapshots (REcontrol); only marketKey + asOfMonth required. */
  workspaceId?: string;
  marketKey: string;
  asOfMonth: string;
  tractIds?: string[];
};

type SenseSnapshotSummary = {
  workspaceId?: string;
  marketKey: string;
  marketId: string;
  asOfMonth: string;
  totalTracts: number;
  processed: number;
  succeeded: number;
  failed: number;
  missingPricing: number;
  missingRent: number;
  missingStructural: number;
  thinCoverage: number;
  failures: Array<{ tractId: string; reason: string }>;
};

type AggRow = {
  tract_id: string;
  month: string;
  price_index: number | null;
  rent_index: number | null;
  coverage: Record<string, any> | null;
};

type AcsRow = {
  tract_id: string;
  metrics: Record<string, any>;
};

type RelativeRow = {
  tract_id: string;
  relative: Record<string, any>;
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const toMonthString = (value: string) => {
  if (!value) {
    throw new Error('as_of_month is required');
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    return `${value}-01`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value.slice(0, 7)}-01`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid as_of_month: ${value}`);
  }
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
};

const addMonths = (month: string, delta: number) => {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const date = new Date(Date.UTC(year, monthIndex + delta, 1));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}-01`;
};

const normalizeCoverage = (
  coverage: Record<string, any> | null,
  key: 'price_index' | 'rent_index',
) => {
  const section = coverage?.[key] ?? {};
  const coverageRatio = Number(section.coverage_ratio ?? section.ratio ?? section.coverage ?? NaN);
  const weightSum = Number(section.total_weight ?? 0);
  const denomWeight = Number(section.denom_weight ?? section.denomWeight ?? 0);
  const zipCount = Number(section.zip_obs ?? section.zipCount ?? 0);
  const missingZipCount = Number(section.missing_zip_count ?? section.missingZipCount ?? 0);
  const fallbackSource =
    typeof section.fallback?.source === 'string' ? section.fallback.source : null;

  let resolvedCoverageRatio = Number.isFinite(coverageRatio) ? coverageRatio : null;
  if (resolvedCoverageRatio == null && Number.isFinite(denomWeight) && denomWeight > 0 && weightSum > 0) {
    resolvedCoverageRatio = denomWeight / weightSum;
  }

  const thinCoverage = resolvedCoverageRatio != null
    ? resolvedCoverageRatio < 0.5
    : denomWeight <= 0;
  return {
    coverageRatio: resolvedCoverageRatio,
    weightSum: Number.isFinite(weightSum) ? weightSum : null,
    denomWeight: Number.isFinite(denomWeight) ? denomWeight : null,
    zipCount: Number.isFinite(zipCount) ? zipCount : null,
    missingZipCount: Number.isFinite(missingZipCount) ? missingZipCount : null,
    fallbackSource,
    thinCoverage,
  };
};

const directionFromDelta = (current: number | null, previous: number | null) => {
  if (current == null || previous == null) return null;
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'flat';
};

const calcVolatility = (values: number[]) => {
  if (values.length < 2) return null;
  const changes: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const current = values[i];
    if (prev === 0) continue;
    changes.push((current - prev) / prev);
  }
  if (changes.length === 0) return null;
  const mean = changes.reduce((sum, v) => sum + v, 0) / changes.length;
  const variance =
    changes.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / changes.length;
  return Math.sqrt(variance);
};

const bucketVolatility = (value: number | null) => {
  if (value == null) return null;
  if (value <= VOLATILITY_LOW) return 'low';
  if (value <= VOLATILITY_MEDIUM) return 'medium';
  return 'high';
};

const scoreFromDirection = (direction: string | null) => {
  if (direction === 'up') return 10;
  if (direction === 'down') return -10;
  return 0;
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const toNumberOrNull = (value: any) => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const pickAcsBaseline = (metrics: Record<string, any>, acsYear: number) => {
  const housing = metrics.housing_stock || {};
  
  // Normalize median_household_income: set to NULL if <= 0 or equals sentinel value
  let normalizedIncome = toNumberOrNull(metrics.median_household_income);
  const warnings = Array.isArray(metrics.warnings) ? [...metrics.warnings] : [];
  
  if (normalizedIncome !== null && (normalizedIncome <= 0 || normalizedIncome === -666666666)) {
    normalizedIncome = null;
    if (!warnings.includes('acs_income_missing')) {
      warnings.push('acs_income_missing');
    }
  }
  
  return {
    year: acsYear,
    population: toNumberOrNull(metrics.population),
    housing_units: toNumberOrNull(metrics.housing_units),
    vacancy_rate: toNumberOrNull(metrics.vacancy_rate),
    owner_occupied_rate: toNumberOrNull(metrics.owner_occupied_rate),
    poverty_rate: toNumberOrNull(metrics.poverty_rate),
    median_household_income: normalizedIncome,
    housing_stock: {
      year_built_buckets: housing.year_built_buckets ?? null,
      units_in_structure_buckets: housing.units_in_structure_buckets ?? null,
    },
    warnings,
  };
};

const getBucketPct = (baseline: any, key: string) =>
  toNumberOrNull(baseline?.housing_stock?.year_built_buckets?.[key]?.pct);

const getStructurePct = (baseline: any, key: string) =>
  toNumberOrNull(baseline?.housing_stock?.units_in_structure_buckets?.[key]?.pct);

const getRelativeBand = (relative: any, group: string, key: string) =>
  relative?.[group]?.[key]?.band ?? null;

const getRelativeDistance = (relative: any, group: string, key: string) =>
  toNumberOrNull(relative?.[group]?.[key]?.distance);

type NeighborhoodQualityFlags = {
  neighborhoodThinCoverage: boolean | null;
  neighborhoodTractCount?: number | null;
  neighborhoodAreaCoveredRatio?: number | null;
  neighborhoodCoherence: 'high' | 'medium' | 'low' | null;
  confidenceCaps: string[];
};

const computeNeighborhoodCoherence = (
  flipStddev: number | null,
  rentStddev: number | null,
): 'high' | 'medium' | 'low' | null => {
  const maxStddev = Math.max(
    flipStddev ?? 0,
    rentStddev ?? 0,
  );
  if (maxStddev <= COHERENCE_HIGH_THRESHOLD) return 'high';
  if (maxStddev <= COHERENCE_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
};

const computeConfidence = (params: {
  structuralPresent: boolean;
  missingPricing: boolean;
  missingRent: boolean;
  thinCoverage: boolean;
  rentFallback: boolean;
  neighborhoodQuality?: NeighborhoodQualityFlags | null;
}) => {
  const reasons: string[] = [];
  let level: ConfidenceLevel = 'high';
  let cap: ConfidenceLevel = 'high';

  if (!params.structuralPresent) {
    cap = 'low';
    reasons.push('structural_baseline_missing');
  }

  if (params.missingPricing || params.missingRent) {
    level = 'low';
    reasons.push('missing_price_or_rent');
  } else if (params.rentFallback) {
    level = 'medium';
    reasons.push('rent_fallback');
  }

  // Apply neighborhood quality caps (Item 4)
  // Note: confidenceCaps are already computed by SQL function, we just apply them
  if (params.neighborhoodQuality) {
    const { neighborhoodAreaCoveredRatio, neighborhoodCoherence } = params.neighborhoodQuality;
    
    // Apply partial coverage cap (replaces thin coverage penalty)
    if (neighborhoodAreaCoveredRatio != null && neighborhoodAreaCoveredRatio < 0.7) {
      if (level === 'high') level = 'medium';
      reasons.push('partial_neighborhood_coverage');
    }
    
    // Apply coherence cap
    if (neighborhoodCoherence === 'low') {
      if (level === 'high') level = 'medium';
      reasons.push('neighborhood_low_coherence');
    }
    
    // If both partial coverage AND low coherence, cap at low
    if (neighborhoodAreaCoveredRatio != null && neighborhoodAreaCoveredRatio < 0.7 && neighborhoodCoherence === 'low') {
      level = 'low';
    }
  }

  const levelIndex = CONFIDENCE_LEVELS.indexOf(level);
  const capIndex = CONFIDENCE_LEVELS.indexOf(cap);
  const finalLevel =
    levelIndex > capIndex ? CONFIDENCE_LEVELS[capIndex] : level;

  return {
    level: finalLevel,
    cap,
    reasons,
    confidenceCaps: params.neighborhoodQuality?.confidenceCaps ?? [],
  };
};

const computeFlipScore = (params: {
  pricingDirections: Record<string, string | null>;
  volatilityBucket: string | null;
  structuralBaseline: any | null;
  relativeMarket: any | null;
}) => {
  const breakdown: Array<{
    key: string;
    label: string;
    points: number;
    direction: string | null;
    refs: string[];
  }> = [
    { key: 'baseline', label: 'Baseline', points: 50, direction: 'baseline', refs: [] },
  ];

  breakdown.push({
    key: 'pricing_yoy',
    label: 'Pricing YoY direction',
    points: scoreFromDirection(params.pricingDirections.yoy),
    direction: params.pricingDirections.yoy,
    refs: ['derived.pricing_index.yoy'],
  });
  breakdown.push({
    key: 'pricing_qoq',
    label: 'Pricing QoQ direction',
    points: scoreFromDirection(params.pricingDirections.qoq),
    direction: params.pricingDirections.qoq,
    refs: ['derived.pricing_index.qoq'],
  });
  breakdown.push({
    key: 'pricing_mom',
    label: 'Pricing MoM direction',
    points: scoreFromDirection(params.pricingDirections.mom),
    direction: params.pricingDirections.mom,
    refs: ['derived.pricing_index.mom'],
  });

  let volatilityAdjustment = 0;
  if (params.volatilityBucket === 'high') {
    volatilityAdjustment = -15;
  } else if (params.volatilityBucket === 'medium') {
    volatilityAdjustment = -7;
  }
  breakdown.push({
    key: 'volatility',
    label: 'Volatility',
    points: volatilityAdjustment,
    direction: params.volatilityBucket,
    refs: ['derived.volatility_6m'],
  });

  const baseline = params.structuralBaseline;
  const pre1960 = getBucketPct(baseline, 'pre_1960') ?? 0;
  const y1960 = getBucketPct(baseline, '1960_1979') ?? 0;
  const olderShare = pre1960 + y1960;

  let olderShareAdjustment = 0;
  if (olderShare > 0.6) {
    olderShareAdjustment = -10;
  } else if (olderShare > 0.4) {
    olderShareAdjustment = -5;
  }
  if (olderShareAdjustment !== 0) {
    breakdown.push({
      key: 'older_stock',
      label: 'Older housing stock share',
      points: olderShareAdjustment,
      direction: olderShare > 0.6 ? 'high' : 'medium',
      refs: ['signals.structural_baseline.metrics.housing_stock.year_built_buckets'],
    });
  }

  const priceDistance = getRelativeDistance(params.relativeMarket, 'zillow', 'price_level');
  let priceLevelAdjustment = 0;
  if (priceDistance != null) {
    if (priceDistance >= 2) priceLevelAdjustment = -5;
    else if (priceDistance >= 1) priceLevelAdjustment = -3;
    else if (priceDistance >= 0.5) priceLevelAdjustment = -1;
  }
  if (priceLevelAdjustment !== 0) {
    breakdown.push({
      key: 'price_level_distance',
      label: 'Price level distance',
      points: priceLevelAdjustment,
      direction: priceDistance != null ? `distance_${priceDistance}` : null,
      refs: ['relative.market.zillow.price_level.distance'],
    });
  }

  const score = clampScore(
    breakdown.reduce((sum, item) => sum + (Number.isFinite(item.points) ? item.points : 0), 0),
  );

  return {
    score,
    breakdown,
    components: {
      direction: {
        yoy: params.pricingDirections.yoy,
        qoq: params.pricingDirections.qoq,
        mom: params.pricingDirections.mom,
        adjustment:
          scoreFromDirection(params.pricingDirections.yoy)
          + scoreFromDirection(params.pricingDirections.qoq)
          + scoreFromDirection(params.pricingDirections.mom),
      },
      volatility: {
        bucket: params.volatilityBucket,
        adjustment: volatilityAdjustment,
      },
      relative: {
        price_level_distance: priceDistance,
        adjustment: priceLevelAdjustment,
      },
      structural: {
        older_share: olderShare,
        adjustment: olderShareAdjustment,
      },
    },
  };
};

const computeRentScore = (params: {
  rentDirections: Record<string, string | null>;
  structuralBaseline: any | null;
  relativeMarket: any | null;
}) => {
  const breakdown: Array<{
    key: string;
    label: string;
    points: number;
    direction: string | null;
    refs: string[];
  }> = [
    { key: 'baseline', label: 'Baseline', points: 50, direction: 'baseline', refs: [] },
  ];

  breakdown.push({
    key: 'rent_yoy',
    label: 'Rent YoY direction',
    points: scoreFromDirection(params.rentDirections.yoy),
    direction: params.rentDirections.yoy,
    refs: ['derived.rent_index.yoy'],
  });
  breakdown.push({
    key: 'rent_qoq',
    label: 'Rent QoQ direction',
    points: scoreFromDirection(params.rentDirections.qoq),
    direction: params.rentDirections.qoq,
    refs: ['derived.rent_index.qoq'],
  });
  breakdown.push({
    key: 'rent_mom',
    label: 'Rent MoM direction',
    points: scoreFromDirection(params.rentDirections.mom),
    direction: params.rentDirections.mom,
    refs: ['derived.rent_index.mom'],
  });

  const ptrDistance = getRelativeDistance(params.relativeMarket, 'zillow', 'price_to_rent');
  let ptrAdjustment = 0;
  if (ptrDistance != null) {
    if (ptrDistance >= 2) ptrAdjustment = -8;
    else if (ptrDistance >= 1) ptrAdjustment = -4;
    else if (ptrDistance >= 0.5) ptrAdjustment = -2;
  }
  if (ptrAdjustment !== 0) {
    breakdown.push({
      key: 'price_to_rent_distance',
      label: 'Price-to-rent distance',
      points: ptrAdjustment,
      direction: ptrDistance != null ? `distance_${ptrDistance}` : null,
      refs: ['relative.market.zillow.price_to_rent.distance'],
    });
  }

  const incomeBand = getRelativeBand(params.relativeMarket, 'acs', 'income');
  const vacancyBand = getRelativeBand(params.relativeMarket, 'acs', 'vacancy');
  const povertyBand = getRelativeBand(params.relativeMarket, 'acs', 'poverty');
  const ownerOccBand = getRelativeBand(params.relativeMarket, 'acs', 'owner_occ');
  const vacancyDistance = getRelativeDistance(params.relativeMarket, 'acs', 'vacancy');
  const povertyDistance = getRelativeDistance(params.relativeMarket, 'acs', 'poverty');

  let incomeAdjustment = 0;
  if (incomeBand === 'low') incomeAdjustment = -6;
  else if (incomeBand === 'high') incomeAdjustment = 3;
  if (incomeAdjustment !== 0) {
    breakdown.push({
      key: 'income_band',
      label: 'Income band',
      points: incomeAdjustment,
      direction: incomeBand,
      refs: ['relative.market.acs.income.band'],
    });
  }

  let vacancyAdjustment = 0;
  if (vacancyBand === 'high') vacancyAdjustment = -6;
  else if (vacancyBand === 'low') vacancyAdjustment = 2;
  if (vacancyDistance != null && vacancyDistance >= 1.5) vacancyAdjustment -= 2;
  if (vacancyAdjustment !== 0) {
    breakdown.push({
      key: 'vacancy_band',
      label: 'Vacancy band',
      points: vacancyAdjustment,
      direction: vacancyBand,
      refs: ['relative.market.acs.vacancy.band'],
    });
  }

  let ownerOccAdjustment = 0;
  if (ownerOccBand === 'high') ownerOccAdjustment = 3;
  else if (ownerOccBand === 'low') ownerOccAdjustment = -4;
  if (ownerOccAdjustment !== 0) {
    breakdown.push({
      key: 'owner_occ_band',
      label: 'Owner-occupied band',
      points: ownerOccAdjustment,
      direction: ownerOccBand,
      refs: ['relative.market.acs.owner_occ.band'],
    });
  }

  let povertyAdjustment = 0;
  if (povertyBand === 'high') povertyAdjustment = -6;
  else if (povertyBand === 'low') povertyAdjustment = 2;
  if (povertyDistance != null && povertyDistance >= 1.5) povertyAdjustment -= 2;
  if (povertyAdjustment !== 0) {
    breakdown.push({
      key: 'poverty_band',
      label: 'Poverty band',
      points: povertyAdjustment,
      direction: povertyBand,
      refs: ['relative.market.acs.poverty.band'],
    });
  }

  const baseline = params.structuralBaseline;
  const multi5 = getStructurePct(baseline, 'multi_5_plus');
  let structureAdjustment = 0;
  if (multi5 != null && multi5 > 0.25) {
    structureAdjustment = 3;
  }
  if (structureAdjustment !== 0) {
    breakdown.push({
      key: 'structure_mix',
      label: 'Structure mix',
      points: structureAdjustment,
      direction: multi5 != null ? `${multi5}` : null,
      refs: ['signals.structural_baseline.metrics.housing_stock.units_in_structure_buckets'],
    });
  }

  const score = clampScore(
    breakdown.reduce((sum, item) => sum + (Number.isFinite(item.points) ? item.points : 0), 0),
  );

  return {
    score,
    breakdown,
    components: {
      direction: {
        yoy: params.rentDirections.yoy,
        qoq: params.rentDirections.qoq,
        mom: params.rentDirections.mom,
        adjustment:
          scoreFromDirection(params.rentDirections.yoy)
          + scoreFromDirection(params.rentDirections.qoq)
          + scoreFromDirection(params.rentDirections.mom),
      },
      price_to_rent: {
        distance: ptrDistance,
        adjustment: ptrAdjustment,
      },
      income_band: {
        band: incomeBand,
        adjustment: incomeAdjustment,
      },
      vacancy_band: {
        band: vacancyBand,
        distance: vacancyDistance,
        adjustment: vacancyAdjustment,
      },
      poverty_band: {
        band: povertyBand,
        distance: povertyDistance,
        adjustment: povertyAdjustment,
      },
      owner_occ_band: {
        band: ownerOccBand,
        adjustment: ownerOccAdjustment,
      },
      structural: {
        multi_5_plus_share: multi5,
        adjustment: structureAdjustment,
      },
    },
  };
};

const computeDriftDirection = (
  priceDirections: Array<string | null>,
  rentDirections: Array<string | null>,
) => {
  const combined = [...priceDirections, ...rentDirections].filter(Boolean) as string[];
  if (combined.length === 0) return null;
  const upCount = combined.filter((d) => d === 'up').length;
  const downCount = combined.filter((d) => d === 'down').length;
  if (upCount >= downCount + 2) return 'improving';
  if (downCount >= upCount + 2) return 'deteriorating';
  return 'stable';
};

/**
 * Calculate drift_runs: consecutive months with consistent drift direction
 * Counts how many consecutive months (including current, looking backwards) have had the same drift direction
 * by examining month-over-month changes in price and rent indexes
 */
const computeDriftRuns = (
  series: AggRow[],
  asOfMonth: string,
  currentDriftDirection: 'improving' | 'stable' | 'deteriorating' | null
): number => {
  if (!currentDriftDirection || series.length < 2) return 0;

  // Sort series by month (ascending), filter to months <= asOfMonth with both price and rent data
  const sorted = [...series]
    .filter((row) => row.month <= asOfMonth && row.price_index != null && row.rent_index != null)
    .sort((a, b) => (a.month > b.month ? 1 : -1));

  if (sorted.length < 2) return 1; // At least 1 month (current) has this drift direction

  let runs = 1; // Start at 1 to include the current month
  // Count backwards from the latest month (current month is already counted)
  for (let i = sorted.length - 2; i >= 0; i--) {
    const current = sorted[i + 1];
    const previous = sorted[i];

    if (!current.price_index || !current.rent_index || !previous.price_index || !previous.rent_index) {
      break;
    }

    // Calculate month-over-month direction for price and rent
    const priceChange = (current.price_index - previous.price_index) / previous.price_index;
    const rentChange = (current.rent_index - previous.rent_index) / previous.rent_index;

    // Determine direction for this month (using same threshold as directionFromDelta)
    const priceDir = priceChange > 0.001 ? 'up' : priceChange < -0.001 ? 'down' : 'flat';
    const rentDir = rentChange > 0.001 ? 'up' : rentChange < -0.001 ? 'down' : 'flat';

    // Compute drift direction for this month (same logic as computeDriftDirection)
    const directions = [priceDir, rentDir].filter((d) => d !== 'flat');
    let monthDrift: 'improving' | 'stable' | 'deteriorating';
    
    if (directions.length === 0) {
      // If both flat, drift is stable
      monthDrift = 'stable';
    } else {
      const upCount = directions.filter((d) => d === 'up').length;
      const downCount = directions.filter((d) => d === 'down').length;
      if (upCount >= downCount + 2) {
        monthDrift = 'improving';
      } else if (downCount >= upCount + 2) {
        monthDrift = 'deteriorating';
      } else {
        monthDrift = 'stable';
      }
    }

    // If this month's drift matches current drift, increment runs
    if (monthDrift === currentDriftDirection) {
      runs++;
    } else {
      // Direction changed, stop counting
      break;
    }
  }

  return runs;
};

const normalizeMonthValue = (value: string | Date) => {
  // Handle Date objects from database
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  }
  return toMonthString(String(value));
};

const buildSignals = (series: AggRow[], asOfMonth: string) => {
  const normalizedAsOfMonth = toMonthString(asOfMonth);
  
  const sorted = [...series]
    .map((row) => ({ ...row, month: normalizeMonthValue(row.month) }))
    .sort((a, b) => (a.month > b.month ? 1 : -1));

  const window = sorted.filter((row) => row.month <= normalizedAsOfMonth);
  const lookup = new Map(sorted.map((row) => [row.month, row]));
  const asOfRow = lookup.get(normalizedAsOfMonth) || null;

  // Find latest available data from ALL rows (not just window), as data may extend beyond asOfMonth
  // Sort descending and find first non-null for better performance and clarity
  const sortedDesc = [...sorted].sort((a, b) => (a.month > b.month ? -1 : 1));
  const latestPricingRow =
    sortedDesc.find((row) => row.price_index != null) ?? null;
  const latestRentRow =
    sortedDesc.find((row) => row.rent_index != null) ?? null;

  // Build history from all available data (sorted), but cap at HISTORY_MONTHS for consistency
  // This ensures we get the full history even if data extends beyond asOfMonth
  const pricingHistoryAll = sorted.filter((row) => row.price_index != null);
  const rentHistoryAll = sorted.filter((row) => row.rent_index != null);
  
  // Take the last HISTORY_MONTHS months (or all available if less)
  const pricingHistory = pricingHistoryAll.slice(-HISTORY_MONTHS);
  const rentHistory = rentHistoryAll.slice(-HISTORY_MONTHS);
  
  // For direction calculations, still use window (filtered to asOfMonth)
  const pricingHistoryForDirections = window.filter((row) => row.price_index != null);
  const rentHistoryForDirections = window.filter((row) => row.rent_index != null);

  return {
    pricing_index: {
      latest: latestPricingRow?.price_index ?? null,
      data_through_month: latestPricingRow?.month ?? null,
      history: {
        months: pricingHistory.map((row) => row.month),
        values: pricingHistory.map((row) => row.price_index),
      },
      coverage: latestPricingRow?.coverage ?? null,
    },
    rent_index: {
      latest: latestRentRow?.rent_index ?? null,
      data_through_month: latestRentRow?.month ?? null,
      history: {
        months: rentHistory.map((row) => row.month),
        values: rentHistory.map((row) => row.rent_index),
      },
      coverage: latestRentRow?.coverage ?? null,
    },
    as_of_row: asOfRow,
  };
};

const buildDirections = (
  series: AggRow[],
  asOfMonth: string,
  pricingDataMonth: string | null,
  rentDataMonth: string | null,
) => {
  const lookup = new Map(series.map((row) => [row.month, row]));
  const pricingMonth = pricingDataMonth ?? asOfMonth;
  const rentMonth = rentDataMonth ?? asOfMonth;

  const pricingCurrent = pricingDataMonth ? lookup.get(pricingMonth) || null : null;
  const pricingPrevQuarter = pricingDataMonth ? lookup.get(addMonths(pricingMonth, -3)) || null : null;
  const pricingPrevYear = pricingDataMonth ? lookup.get(addMonths(pricingMonth, -12)) || null : null;

  const rentCurrent = rentDataMonth ? lookup.get(rentMonth) || null : null;
  const rentPrevQuarter = rentDataMonth ? lookup.get(addMonths(rentMonth, -3)) || null : null;
  const rentPrevYear = rentDataMonth ? lookup.get(addMonths(rentMonth, -12)) || null : null;

  const pricingHistory = series
    .filter((row) => row.month <= pricingMonth && row.price_index != null)
    .sort((a, b) => (a.month > b.month ? 1 : -1));
  const rentHistory = series
    .filter((row) => row.month <= rentMonth && row.rent_index != null)
    .sort((a, b) => (a.month > b.month ? 1 : -1));

  const pricingPrevNonNull = pricingHistory.length > 1 ? pricingHistory[pricingHistory.length - 2] : null;
  const rentPrevNonNull = rentHistory.length > 1 ? rentHistory[rentHistory.length - 2] : null;

  return {
    pricing: {
      mom: directionFromDelta(pricingCurrent?.price_index ?? null, pricingPrevNonNull?.price_index ?? null),
      qoq: directionFromDelta(pricingCurrent?.price_index ?? null, pricingPrevQuarter?.price_index ?? null),
      yoy: directionFromDelta(pricingCurrent?.price_index ?? null, pricingPrevYear?.price_index ?? null),
    },
    rent: {
      mom: directionFromDelta(rentCurrent?.rent_index ?? null, rentPrevNonNull?.rent_index ?? null),
      qoq: directionFromDelta(rentCurrent?.rent_index ?? null, rentPrevQuarter?.rent_index ?? null),
      yoy: directionFromDelta(rentCurrent?.rent_index ?? null, rentPrevYear?.rent_index ?? null),
    },
  };
};

const buildVolatility = (series: AggRow[]) => {
  const recent = series.slice(-VOLATILITY_MONTHS);
  const priceValues = recent.map((row) => row.price_index).filter((v): v is number => v != null);
  const rentValues = recent.map((row) => row.rent_index).filter((v): v is number => v != null);
  const priceVol = calcVolatility(priceValues);
  const rentVol = calcVolatility(rentValues);
  const combined = [priceVol, rentVol].filter((v): v is number => v != null);
  if (combined.length === 0) return { value: null, bucket: null };
  const avg = combined.reduce((sum, v) => sum + v, 0) / combined.length;
  return { value: avg, bucket: bucketVolatility(avg) };
};

const buildDeterministicPayload = (params: {
  tractId: string;
  marketKey: string;
  asOfMonth: string;
  series: AggRow[];
  acs: AcsRow | null;
  acsYear: number;
  relative: Record<string, any> | null;
  neighborhoodQuality?: NeighborhoodQualityFlags | null;
  neighborhoodMarketSpreads?: { price_yoy_spread: number | null; rent_yoy_spread: number | null } | null;
}) => {
  const signals = buildSignals(params.series, params.asOfMonth);
  const directions = buildDirections(
    params.series,
    params.asOfMonth,
    signals.pricing_index.data_through_month ?? null,
    signals.rent_index.data_through_month ?? null,
  );
  const volatility = buildVolatility(params.series);
  const pricingCoverage = normalizeCoverage(signals.pricing_index.coverage, 'price_index');
  const rentCoverage = normalizeCoverage(signals.rent_index.coverage, 'rent_index');
  const thinCoverage = pricingCoverage.thinCoverage || rentCoverage.thinCoverage;

  const structuralPresent = Boolean(params.acs?.metrics);
  const structuralBaseline = params.acs?.metrics
    ? pickAcsBaseline(params.acs.metrics, params.acsYear)
    : null;

  const missingPricing = signals.pricing_index.latest == null;
  const missingRent = signals.rent_index.latest == null;
  const missingStructural = !structuralPresent;

  const pricingStale =
    Boolean(signals.pricing_index.data_through_month) &&
    signals.pricing_index.data_through_month! < params.asOfMonth;
  const rentStale =
    Boolean(signals.rent_index.data_through_month) &&
    signals.rent_index.data_through_month! < params.asOfMonth;

  const confidence = computeConfidence({
    structuralPresent,
    missingPricing,
    missingRent,
    thinCoverage,
    rentFallback: rentCoverage.fallbackSource === 'market_level',
    neighborhoodQuality: params.neighborhoodQuality ?? null,
  });

  const flipResult = computeFlipScore({
    pricingDirections: directions.pricing,
    volatilityBucket: volatility.bucket,
    structuralBaseline,
    relativeMarket: params.relative,
  });

  const rentResult = computeRentScore({
    rentDirections: directions.rent,
    structuralBaseline,
    relativeMarket: params.relative,
  });

  const driftDirection = computeDriftDirection(
    Object.values(directions.pricing),
    Object.values(directions.rent),
  );
  const resolvedDrift = driftDirection ?? 'stable';
  const driftReason = driftDirection ? null : 'insufficient_index_data';
  
  // Calculate drift_runs: consecutive months with consistent drift direction
  const driftRuns = computeDriftRuns(
    params.series,
    params.asOfMonth,
    resolvedDrift
  );

  return {
    structural_baseline_present: structuralPresent,
    structural_baseline_missing: missingStructural,
    meta: {
      engine_version: SNAPSHOT_ENGINE_VERSION,
      as_of_month: params.asOfMonth,
      market_key: params.marketKey,
      relative_version: params.relative?.meta?.version ?? null,
      acs_primary_year_used: params.acsYear,
      built_at: new Date().toISOString(),
    },
    signals: {
      pricing_index: signals.pricing_index,
      rent_index: signals.rent_index,
      structural_baseline: structuralBaseline
        ? { year: params.acsYear, metrics: structuralBaseline }
        : { year: params.acsYear, metrics: null },
    },
    derived: {
      pricing_index: directions.pricing,
      rent_index: directions.rent,
      volatility_6m: volatility.bucket,
      drift_direction: resolvedDrift,
      drift_runs: driftRuns,
      drift_reason: driftReason,
      confidence,
    },
    scores: {
      flip_base_score: flipResult.score,
      rent_base_score: rentResult.score,
      breakdown: {
        flip: flipResult.breakdown,
        rent: rentResult.breakdown,
      },
      delta_vs_prev_month: null,
      score_explain: {
        pricing_directions: directions.pricing,
        rent_directions: directions.rent,
        volatility_6m: volatility.bucket,
        pricing_index_latest: signals.pricing_index.latest,
        rent_index_latest: signals.rent_index.latest,
        structural_baseline_present: structuralPresent,
        relative_bands: {
          income: getRelativeBand(params.relative, 'acs', 'income'),
          vacancy: getRelativeBand(params.relative, 'acs', 'vacancy'),
          poverty: getRelativeBand(params.relative, 'acs', 'poverty'),
          owner_occ: getRelativeBand(params.relative, 'acs', 'owner_occ'),
          price_level: getRelativeBand(params.relative, 'zillow', 'price_level'),
          rent_level: getRelativeBand(params.relative, 'zillow', 'rent_level'),
          price_to_rent: getRelativeBand(params.relative, 'zillow', 'price_to_rent'),
        },
        components: {
          flip: flipResult.components,
          rent: rentResult.components,
        },
        coverage_flags: {
          pricing_thin: pricingCoverage.thinCoverage,
          rent_thin: rentCoverage.thinCoverage,
          rent_fallback_source: rentCoverage.fallbackSource,
        },
      },
    },
    relative: {
      market: params.relative,
    },
    flags: {
      missing_pricing_index: missingPricing,
      missing_rent_index: missingRent,
      missing_structural_baseline: missingStructural,
      thin_coverage_pricing: pricingCoverage.thinCoverage,
      thin_coverage_rent: rentCoverage.thinCoverage,
      rent_index_fallback: rentCoverage.fallbackSource,
      pricing_index_stale: pricingStale,
      rent_index_stale: rentStale,
    },
    neighborhood_quality: params.neighborhoodQuality
      ? {
          neighborhood_thin_coverage: params.neighborhoodQuality.neighborhoodThinCoverage,
          neighborhood_tract_count: params.neighborhoodQuality.neighborhoodTractCount,
          neighborhood_area_covered_ratio: params.neighborhoodQuality.neighborhoodAreaCoveredRatio,
          neighborhood_coherence: params.neighborhoodQuality.neighborhoodCoherence,
          confidence_caps: params.neighborhoodQuality.confidenceCaps,
        }
      : null,
    neighborhood_vs_market_spread: params.neighborhoodMarketSpreads
      ? {
          price_yoy: params.neighborhoodMarketSpreads.price_yoy_spread,
          rent_yoy: params.neighborhoodMarketSpreads.rent_yoy_spread,
        }
      : null,
  };
};

async function resolveMarket(
  marketKey: string,
): Promise<{ marketId: string; marketKey: string }> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .schema('readvise')
    .from('sense_markets')
    .select('id, market_key')
    .eq('market_key', marketKey)
    .single();

  if (error || !data) {
    throw new Error(`Market not found for key "${marketKey}": ${error?.message || 'missing record'}`);
  }

  return { marketId: data.id, marketKey: data.market_key };
}

async function loadSenseSettings(workspaceId: string) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .schema('readvise')
    .from('sense_settings')
    .select('market_id, tract_filter_mode, tract_allowlist, acs_primary_year')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load sense_settings: ${error.message}`);
  }

  return {
    marketId: data?.market_id ?? null,
    tractFilterMode: (data?.tract_filter_mode ?? null) as 'allowlist' | 'all' | null,
    tractAllowlist: (data?.tract_allowlist ?? null) as string[] | null,
    acsPrimaryYear: data?.acs_primary_year ?? null,
  };
}

async function resolveAcsYear(settings: { acsPrimaryYear: number | null }) {
  if (settings.acsPrimaryYear) {
    return settings.acsPrimaryYear;
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .schema('readvise')
    .from('sense_src_acs_tract_yearly')
    .select('year')
    .order('year', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load ACS year: ${error.message}`);
  }

  return data?.[0]?.year ?? DEFAULT_ACS_YEAR;
}

async function loadMarketTracts(marketId: string) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .schema('readvise')
    .from('sense_market_tracts')
    .select('tract_id')
    .eq('market_id', marketId)
    .eq('active', true);

  if (error) {
    throw new Error(`Failed to load sense_market_tracts: ${error.message}`);
  }

  return (data || [])
    .map((row: { tract_id: string | null }) => row.tract_id)
    .filter((tractId): tractId is string => Boolean(tractId));
}

async function loadAggSeries(
  tractIds: string[],
  startMonth: string,
  endMonth: string,
): Promise<Map<string, AggRow[]>> {
  const admin = getAdminClient();
  const result = new Map<string, AggRow[]>();
  const pageSize = 1000;

  for (const chunk of chunkArray(tractIds, 300)) {
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .schema('readvise')
        .from('sense_agg_tract_monthly')
        .select('tract_id, month, price_index, rent_index, coverage')
        .in('tract_id', chunk)
        .gte('month', startMonth)
        .lte('month', endMonth)
        .order('month', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        throw new Error(`Failed to load sense_agg_tract_monthly: ${error.message}`);
      }

      (data || []).forEach((row: AggRow) => {
        if (!result.has(row.tract_id)) {
          result.set(row.tract_id, []);
        }
        result.get(row.tract_id)!.push(row);
      });

      if (!data || data.length < pageSize) {
        break;
      }
      from += pageSize;
    }
  }

  return result;
}

async function loadAcsBaseline(tractIds: string[], acsYear: number): Promise<Map<string, AcsRow>> {
  const admin = getAdminClient();
  const result = new Map<string, AcsRow>();

  for (const chunk of chunkArray(tractIds, 500)) {
    const { data, error } = await admin
      .schema('readvise')
      .from('sense_src_acs_tract_yearly')
      .select('tract_id, metrics')
      .eq('year', acsYear)
      .in('tract_id', chunk);

    if (error) {
      throw new Error(`Failed to load sense_src_acs_tract_yearly: ${error.message}`);
    }

    (data || []).forEach((row: AcsRow) => {
      result.set(row.tract_id, row);
    });
  }

  return result;
}

async function loadRelativeFeatures(
  marketId: string,
  asOfMonth: string,
  tractIds: string[],
): Promise<Map<string, RelativeRow>> {
  const admin = getAdminClient();
  const result = new Map<string, RelativeRow>();

  for (const chunk of chunkArray(tractIds, 500)) {
    const { data, error } = await admin
      .schema('readvise')
      .from('sense_tract_relative_features_v1')
      .select('tract_id, relative')
      .eq('market_id', marketId)
      .eq('as_of_month', asOfMonth)
      .in('tract_id', chunk);

    if (error) {
      throw new Error(`Failed to load sense_tract_relative_features_v1: ${error.message}`);
    }

    (data || []).forEach((row: RelativeRow) => {
      result.set(row.tract_id, row);
    });
  }

  return result;
}

async function loadActiveLayerId(
  workspaceId: string,
  marketKey: string,
): Promise<string | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .schema('readvise')
    .from('sense_neighborhood_layers')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('market_key', marketKey)
    .eq('active', true)
    .order('priority', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`Failed to load active layer: ${error.message}`);
    return null;
  }

  return data?.id ?? null;
}

async function loadNeighborhoodQualityFlags(
  workspaceId: string,
  marketKey: string,
  layerId: string | null,
  tractIds: string[],
  asOfMonth: string,
): Promise<Map<string, NeighborhoodQualityFlags>> {
  const admin = getAdminClient();
  const result = new Map<string, NeighborhoodQualityFlags>();

  if (!layerId) {
    return result;
  }

  // Use SQL function to load quality flags for each tract (in parallel batches)
  for (const chunk of chunkArray(tractIds, 100)) {
    const promises = chunk.map(async (tractId) => {
      const { data, error } = await admin.schema('readvise').rpc(
        'sense_get_neighborhood_quality_flags',
        {
          _workspace_id: workspaceId,
          _market_key: marketKey,
          _layer_id: layerId,
          _tract_id: tractId,
          _as_of_month: asOfMonth,
        },
      );

      if (error) {
        // Log warning but don't fail - this is optional data
        console.warn(
          `Failed to load neighborhood quality flags for tract ${tractId}: ${error.message}`,
        );
        return null;
      }

      if (data) {
        return {
          tractId,
          flags: {
            neighborhoodThinCoverage: data.neighborhood_thin_coverage ?? null,
            neighborhoodTractCount: data.neighborhood_tract_count ?? null,
            neighborhoodAreaCoveredRatio: data.neighborhood_area_covered_ratio ?? null,
            neighborhoodCoherence:
              (data.neighborhood_coherence as 'high' | 'medium' | 'low' | null) ?? null,
            confidenceCaps: Array.isArray(data.confidence_caps)
              ? (data.confidence_caps as string[])
              : [],
          },
        };
      }
      return null;
    });

    const results = await Promise.all(promises);
    for (const item of results) {
      if (item) {
        result.set(item.tractId, item.flags);
      }
    }
  }

  return result;
}

async function loadNeighborhoodMarketSpreads(
  workspaceId: string,
  marketKey: string,
  layerId: string | null,
  tractIds: string[],
  asOfMonth: string,
): Promise<Map<string, { price_yoy_spread: number | null; rent_yoy_spread: number | null }>> {
  const admin = getAdminClient();
  const result = new Map<string, { price_yoy_spread: number | null; rent_yoy_spread: number | null }>();

  if (!layerId) {
    return result;
  }

  // Get neighborhood IDs for these tracts
  const { data: weightsData, error: weightsError } = await admin
    .schema('readvise')
    .from('sense_neighborhood_tract_weights')
    .select('tract_id, neighborhood_id')
    .eq('workspace_id', workspaceId)
    .eq('market_key', marketKey)
    .eq('layer_id', layerId)
    .in('tract_id', tractIds);

  if (weightsError || !weightsData || weightsData.length === 0) {
    return result;
  }

  // Group by neighborhood_id (use largest weight per tract)
  const tractToNeighborhood = new Map<string, string>();
  const neighborhoodMap = new Map<string, Set<string>>();

  for (const row of weightsData) {
    if (!row.tract_id || !row.neighborhood_id) continue;
    if (!tractToNeighborhood.has(row.tract_id)) {
      tractToNeighborhood.set(row.tract_id, row.neighborhood_id);
    }
    if (!neighborhoodMap.has(row.neighborhood_id)) {
      neighborhoodMap.set(row.neighborhood_id, new Set());
    }
    neighborhoodMap.get(row.neighborhood_id)!.add(row.tract_id);
  }

  const neighborhoodIds = Array.from(neighborhoodMap.keys());

  if (neighborhoodIds.length === 0) {
    return result;
  }

  // Load neighborhood aggregates
  const { data: aggData, error: aggError } = await admin
    .schema('readvise')
    .from('sense_neighborhood_agg_monthly')
    .select('neighborhood_id, price_yoy_spread, rent_yoy_spread')
    .eq('workspace_id', workspaceId)
    .eq('market_key', marketKey)
    .eq('layer_id', layerId)
    .eq('month', asOfMonth)
    .in('neighborhood_id', neighborhoodIds);

  if (aggError || !aggData) {
    return result;
  }

  // Map neighborhood spreads to tracts
  const neighborhoodSpreads = new Map<string, { price_yoy_spread: number | null; rent_yoy_spread: number | null }>();
  for (const row of aggData) {
    if (row.neighborhood_id) {
      neighborhoodSpreads.set(row.neighborhood_id, {
        price_yoy_spread: row.price_yoy_spread ?? null,
        rent_yoy_spread: row.rent_yoy_spread ?? null,
      });
    }
  }

  // Map back to tracts
  for (const [tractId, neighborhoodId] of tractToNeighborhood.entries()) {
    const spreads = neighborhoodSpreads.get(neighborhoodId);
    if (spreads) {
      result.set(tractId, spreads);
    }
  }

  return result;
}

export async function buildSenseSnapshots(
  params: SenseSnapshotParams,
  options: { dryRun?: boolean; debug?: boolean } = {},
): Promise<SenseSnapshotSummary> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to build snapshots.');
  }

  const admin = getAdminClient();
  const asOfMonth = toMonthString(params.asOfMonth);
  const { marketId, marketKey } = await resolveMarket(params.marketKey);
  const isMarketLevel = params.workspaceId == null;

  let settings: { marketId: string | null; tractFilterMode: 'allowlist' | 'all' | null; tractAllowlist: string[] | null; acsPrimaryYear: number | null } = {
    marketId: null,
    tractFilterMode: null,
    tractAllowlist: null,
    acsPrimaryYear: null,
  };
  if (params.workspaceId) {
    settings = await loadSenseSettings(params.workspaceId);
    if (settings.marketId && settings.marketId !== marketId) {
      console.log(
        `[SenseSnapshot] Aligning workspace ${params.workspaceId} to market ${marketKey} (was ${settings.marketId})`,
      );
      const { error: updateErr } = await admin
        .schema('readvise')
        .from('sense_settings')
        .update({ market_id: marketId })
        .eq('workspace_id', params.workspaceId);
      if (updateErr) {
        console.warn(
          `[SenseSnapshot] Could not update sense_settings.market_id: ${updateErr.message}`,
        );
      }
    }
  }

  const marketTracts = await loadMarketTracts(marketId);
  let tractIds = [...marketTracts];

  if (params.tractIds && params.tractIds.length > 0) {
    const overrideSet = new Set(params.tractIds);
    tractIds = tractIds.filter((tractId) => overrideSet.has(tractId));
  } else if (!isMarketLevel && settings.tractFilterMode === 'allowlist' && settings.tractAllowlist?.length) {
    const allowSet = new Set(settings.tractAllowlist);
    tractIds = tractIds.filter((tractId) => allowSet.has(tractId));
  }

  const startMonth = addMonths(asOfMonth, -(HISTORY_MONTHS - 1));
  const endMonthForLoad = addMonths(asOfMonth, 24);
  const seriesMap = await loadAggSeries(tractIds, startMonth, endMonthForLoad);
  const acsYear = await resolveAcsYear(settings);
  const acsMap = await loadAcsBaseline(tractIds, acsYear);
  const relativeMap = await loadRelativeFeatures(marketId, asOfMonth, tractIds);

  const workspaceIdForLayer = params.workspaceId ?? '00000000-0000-0000-0000-000000000000';
  const activeLayerId = await loadActiveLayerId(workspaceIdForLayer, marketKey);
  const neighborhoodQualityMap = await loadNeighborhoodQualityFlags(
    workspaceIdForLayer,
    marketKey,
    activeLayerId,
    tractIds,
    asOfMonth,
  );
  const neighborhoodMarketSpreadsMap = await loadNeighborhoodMarketSpreads(
    workspaceIdForLayer,
    marketKey,
    activeLayerId,
    tractIds,
    asOfMonth,
  );

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let missingPricing = 0;
  let missingRent = 0;
  let missingStructural = 0;
  let thinCoverage = 0;
  const failures: Array<{ tractId: string; reason: string }> = [];

  const rows: Array<{
    market_id: string;
    tract_id: string;
    as_of_month: string;
    deterministic: Record<string, any>;
  }> = [];

  for (const tractId of tractIds) {
    processed += 1;
    try {
      const series = seriesMap.get(tractId) || [];
      const acs = acsMap.get(tractId) ?? null;

      const deterministic = buildDeterministicPayload({
        tractId,
        marketKey,
        asOfMonth,
        series,
        acs,
        acsYear,
        relative: relativeMap.get(tractId)?.relative ?? null,
        neighborhoodQuality: neighborhoodQualityMap.get(tractId) ?? null,
        neighborhoodMarketSpreads: neighborhoodMarketSpreadsMap.get(tractId) ?? null,
      });

      if (options.debug && processed <= 5) {
        console.log('[SenseSnapshot][debug]', {
          tractId,
          series_rows: series.length,
          series_months: series.map((row) => row.month),
          as_of_month: asOfMonth,
          as_of_row: series.find((row) => row.month === asOfMonth) || null,
        });
      }

      if (deterministic.flags.missing_pricing_index) missingPricing += 1;
      if (deterministic.flags.missing_rent_index) missingRent += 1;
      if (deterministic.flags.missing_structural_baseline) missingStructural += 1;
      if (deterministic.flags.thin_coverage_pricing || deterministic.flags.thin_coverage_rent) {
        thinCoverage += 1;
      }

      rows.push({
        market_id: marketId,
        tract_id: tractId,
        as_of_month: asOfMonth,
        deterministic,
      });
      succeeded += 1;
    } catch (error: any) {
      failed += 1;
      if (failures.length < 10) {
        failures.push({
          tractId,
          reason: error?.message || 'unknown_error',
        });
      }
    }
  }

  if (!options.dryRun && rows.length > 0) {
    for (const chunk of chunkArray(rows, 200)) {
      const { error } = await admin
        .schema('readvise')
        .from('sense_input_snapshots')
        .upsert(chunk, { onConflict: 'market_id,tract_id,as_of_month' });

      if (error) {
        throw new Error(`Failed to upsert sense_input_snapshots: ${error.message}`);
      }
    }
  }

  return {
    workspaceId: params.workspaceId,
    marketKey,
    marketId,
    asOfMonth,
    totalTracts: tractIds.length,
    processed,
    succeeded,
    failed,
    missingPricing,
    missingRent,
    missingStructural,
    thinCoverage,
    failures,
  };
}
