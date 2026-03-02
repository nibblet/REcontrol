import { getAdminClient } from '@/lib/supabase/admin';

const DATE_COLUMN_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;
const DEFAULT_MONTHS_BACK = 24;

const digitsOnly = (value: string) => value.replace(/\D/g, '');
const normalizeZip = (value: string) => digitsOnly(value).padStart(5, '0').slice(0, 5);

const parseCsvLine = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        const nextChar = line[i + 1];
        if (nextChar === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
};

async function loadAllowedMarketZips(marketId: string, minWeight: number) {
  const admin = getAdminClient();
  const zipSet = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .schema('readvise')
      .rpc('sense_market_zips', { market_id: marketId, min_weight: minWeight })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    data.forEach((row: { zip: string | null }) => {
      if (row.zip) zipSet.add(row.zip);
    });
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return zipSet;
}

export type ZillowIngestResult = {
  rowsProcessed: number;
  rowsEmitted: number;
  filteredZipCount: number;
  invalidZipCount: number;
  invalidValueCount: number;
  batches: number;
};

export async function ingestZillowZipCsv(params: {
  csvText: string;
  dataset: string;
  monthsBack?: number;
  marketId?: string | null;
  minWeight?: number;
  allowedZips?: Set<string> | null;
}): Promise<ZillowIngestResult> {
  const admin = getAdminClient();
  const monthsBack = params.monthsBack ?? DEFAULT_MONTHS_BACK;
  const minWeight = params.minWeight ?? 0;

  const emptyResult: ZillowIngestResult = {
    rowsProcessed: 0,
    rowsEmitted: 0,
    filteredZipCount: 0,
    invalidZipCount: 0,
    invalidValueCount: 0,
    batches: 0,
  };
  if (!params.csvText || !params.csvText.trim()) return emptyResult;

  const allowedZips =
    params.allowedZips !== undefined
      ? params.allowedZips
      : params.marketId
        ? await loadAllowedMarketZips(params.marketId, minWeight)
        : null;

  const lines = params.csvText.split(/\r?\n/);
  let header: string[] | null = null;
  let zipIndex = -1;
  const dateColumns: Array<{ index: number; label: string }> = [];
  let rowCount = 0;
  let emittedRows = 0;
  let invalidZipCount = 0;
  let invalidValueCount = 0;
  let filteredZipCount = 0;
  let batchCount = 0;
  const buffer: Array<{ zip: string; month: string; dataset: string; value: number | null }> = [];

  const flush = async () => {
    if (!buffer.length) return;
    const { error } = await admin
      .schema('core')
      .from('sense_src_zillow_zip_monthly')
      .upsert(buffer, { onConflict: 'zip,month,dataset' });
    if (error) throw new Error(error.message);
    batchCount += 1;
    buffer.length = 0;
  };

  for (const line of lines) {
    if (!header) {
      header = parseCsvLine(line);
      zipIndex = header.indexOf('RegionName');
      if (zipIndex === -1) throw new Error('Missing RegionName column in CSV header');
      header.forEach((column, index) => {
        if (DATE_COLUMN_REGEX.test(column)) dateColumns.push({ index, label: column });
      });
      if (!dateColumns.length) throw new Error('No date columns found in CSV header');
      if (monthsBack > 0 && dateColumns.length > monthsBack) {
        dateColumns.splice(0, dateColumns.length - monthsBack);
      }
      continue;
    }
    if (!line.trim()) continue;

    rowCount += 1;
    const columns = parseCsvLine(line);
    const zipRaw = columns[zipIndex] ?? '';
    const zip = normalizeZip(zipRaw);
    if (!zip || zip.length !== 5) {
      invalidZipCount += 1;
      continue;
    }
    if (allowedZips && !allowedZips.has(zip)) {
      filteredZipCount += 1;
      continue;
    }

    for (const { index, label } of dateColumns) {
      const rawValue = (columns[index] ?? '').trim();
      if (!rawValue) {
        buffer.push({ zip, month: label, dataset: params.dataset, value: null });
        emittedRows += 1;
        continue;
      }
      const cleaned = rawValue.replace(/[$,]/g, '');
      const numericValue = Number(cleaned);
      if (!Number.isFinite(numericValue)) {
        invalidValueCount += 1;
        buffer.push({ zip, month: label, dataset: params.dataset, value: null });
        emittedRows += 1;
        continue;
      }
      buffer.push({ zip, month: label, dataset: params.dataset, value: numericValue });
      emittedRows += 1;
    }
    if (buffer.length >= BATCH_SIZE) await flush();
  }

  await flush();

  return {
    rowsProcessed: rowCount,
    rowsEmitted: emittedRows,
    filteredZipCount,
    invalidZipCount,
    invalidValueCount,
    batches: batchCount,
  };
}

export async function loadAllMarketsZips(
  minWeight = 0,
): Promise<{ zipSet: Set<string>; marketCount: number }> {
  const admin = getAdminClient();
  const { data: markets, error: mErr } = await admin.schema('core').from('sense_markets').select('id, market_key');
  if (mErr) throw new Error(`Failed to load sense_markets: ${mErr.message}`);
  if (!markets?.length) return { zipSet: new Set(), marketCount: 0 };

  const zipSet = new Set<string>();
  let marketCount = 0;
  for (const market of markets) {
    const marketZips = await loadAllowedMarketZips(market.id, minWeight);
    if (marketZips.size > 0) {
      marketCount += 1;
      for (const zip of marketZips) zipSet.add(zip);
    }
  }
  return { zipSet, marketCount };
}

export type ZillowAllMarketsResult = {
  dataset: string;
  marketCount: number;
  totalZips: number;
  ingest: ZillowIngestResult;
};

export async function ingestZillowAllMarkets(params: {
  csvText: string;
  dataset: string;
  monthsBack?: number;
  minWeight?: number;
}): Promise<ZillowAllMarketsResult> {
  const { zipSet, marketCount } = await loadAllMarketsZips(params.minWeight ?? 0);
  const ingest = await ingestZillowZipCsv({
    csvText: params.csvText,
    dataset: params.dataset,
    monthsBack: params.monthsBack,
    allowedZips: zipSet.size > 0 ? zipSet : null,
  });
  return {
    dataset: params.dataset,
    marketCount,
    totalZips: zipSet.size,
    ingest,
  };
}
