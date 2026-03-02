/**
 * HUD SAFMR (Small Area Fair Market Rent) ingest pipeline stage.
 * Parse SAFMR XLSX (buffer) → filter to market ZIPs → upsert sense_src_safmr_zip → call sense_refresh_safmr_tract_projection.
 */

import * as XLSX from 'xlsx';
import fs from 'fs/promises';
import { getAdminClient } from '@/lib/supabase/admin';

const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;

const BEDROOM_COLUMNS: Record<string, number> = {
  safmr_0br: 0,
  safmr_1br: 1,
  safmr_2br: 2,
  safmr_3br: 3,
  safmr_4br: 4,
  efficiency: 0,
  'one-bedroom': 1,
  'two-bedroom': 2,
  'three-bedroom': 3,
  'four-bedroom': 4,
};

const normalizeZip = (value: string | number): string => {
  const str = String(value).replace(/\D/g, '');
  return str.padStart(5, '0').slice(0, 5);
};

const isValidZip = (zip: string): boolean => /^[0-9]{5}$/.test(zip);

export type SafmrIngestResult = {
  rowsIngested: number;
  rowsFiltered: number;
  invalidZipCount: number;
  tractsProjected: number;
  batches: number;
};

async function loadAllowedMarketZips(marketId: string, minWeight: number): Promise<Set<string>> {
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
    for (const row of data) {
      if (row.zip) zipSet.add(row.zip);
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return zipSet;
}

function parseSafmrXlsx(buffer: Buffer): Array<{ zip: string; bedrooms: number; safmr_value: number }> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('SAFMR XLSX has no sheets');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  if (rows.length === 0) throw new Error('SAFMR XLSX sheet is empty');

  const firstRow = rows[0];
  const headers = Object.keys(firstRow);
  const bedroomMap: Array<{ header: string; bedrooms: number }> = [];

  for (const header of headers) {
    const normalized = header.toLowerCase().replace(/[\s_-]+/g, '_').trim();
    if (normalized in BEDROOM_COLUMNS) {
      bedroomMap.push({ header, bedrooms: BEDROOM_COLUMNS[normalized] });
    }
  }

  if (bedroomMap.length === 0) {
    throw new Error(`No bedroom columns found in SAFMR XLSX. Headers: ${headers.join(', ')}`);
  }

  const zipHeader = headers.find((h) => {
    const low = h.toLowerCase().replace(/[\s_-]+/g, '');
    return low === 'zip' || low === 'zipcode' || low === 'zip5';
  });
  if (!zipHeader) {
    throw new Error(`No ZIP column found in SAFMR XLSX. Headers: ${headers.join(', ')}`);
  }

  const result: Array<{ zip: string; bedrooms: number; safmr_value: number }> = [];

  for (const row of rows) {
    const rawZip = row[zipHeader];
    if (rawZip == null) continue;

    const zip = normalizeZip(String(rawZip));
    if (!isValidZip(zip)) continue;

    for (const { header, bedrooms } of bedroomMap) {
      const rawValue = row[header];
      if (rawValue == null) continue;

      const cleaned = String(rawValue).replace(/[$,\s]/g, '');
      const numericValue = Number(cleaned);
      if (!Number.isFinite(numericValue) || numericValue <= 0) continue;

      result.push({ zip, bedrooms, safmr_value: numericValue });
    }
  }

  return result;
}

async function runSafmrIngest(params: {
  buffer: Buffer;
  year: number;
  sourceVintage: string;
  marketId: string;
  marketKey: string;
  asOfQuarter: string;
  minWeight: number;
}): Promise<SafmrIngestResult> {
  const admin = getAdminClient();

  const allRows = parseSafmrXlsx(params.buffer);

  if (allRows.length === 0) {
    return { rowsIngested: 0, rowsFiltered: 0, invalidZipCount: 0, tractsProjected: 0, batches: 0 };
  }

  const allowedZips = await loadAllowedMarketZips(params.marketId, params.minWeight);
  let filteredCount = 0;
  let invalidCount = 0;
  const marketRows: Array<{
    zip: string;
    year: number;
    bedrooms: number;
    safmr_value: number;
    source_vintage: string;
  }> = [];

  const dedupMap = new Map<string, (typeof marketRows)[number]>();
  for (const row of allRows) {
    if (!isValidZip(row.zip)) {
      invalidCount++;
      continue;
    }
    if (!allowedZips.has(row.zip)) {
      filteredCount++;
      continue;
    }
    const key = `${row.zip}:${row.bedrooms}`;
    dedupMap.set(key, {
      zip: row.zip,
      year: params.year,
      bedrooms: row.bedrooms,
      safmr_value: row.safmr_value,
      source_vintage: params.sourceVintage,
    });
  }
  marketRows.push(...dedupMap.values());

  let batchCount = 0;
  for (let i = 0; i < marketRows.length; i += BATCH_SIZE) {
    const batch = marketRows.slice(i, i + BATCH_SIZE);
    const { error } = await admin
      .schema('core')
      .from('sense_src_safmr_zip')
      .upsert(batch, { onConflict: 'year,zip,bedrooms' });
    if (error) throw new Error(`SAFMR upsert batch failed: ${error.message}`);
    batchCount++;
  }

  const { data: projectedRows, error: projErr } = await admin.schema('readvise').rpc('sense_refresh_safmr_tract_projection', {
    _market_key: params.marketKey,
    _as_of_quarter: params.asOfQuarter,
    _year: params.year,
    _source_vintage: params.sourceVintage,
    _min_market_zip_weight: params.minWeight,
  });

  if (projErr) throw new Error(`SAFMR tract projection failed: ${projErr.message}`);

  return {
    rowsIngested: marketRows.length,
    rowsFiltered: filteredCount,
    invalidZipCount: invalidCount,
    tractsProjected: typeof projectedRows === 'number' ? projectedRows : 0,
    batches: batchCount,
  };
}

/**
 * Ingest SAFMR directly from an in-memory Buffer (used by upload/import flow).
 */
export async function ingestSafmrFromBuffer(params: {
  buffer: Buffer;
  year: number;
  sourceVintage: string;
  marketId: string;
  marketKey: string;
  asOfQuarter: string;
  minWeight?: number;
}): Promise<SafmrIngestResult> {
  return runSafmrIngest({ ...params, minWeight: params.minWeight ?? 0.2 });
}

/**
 * Ingest SAFMR data for a specific market from a file on disk.
 */
export async function ingestSafmrForMarket(params: {
  xlsxPath: string;
  year: number;
  sourceVintage: string;
  marketId: string;
  marketKey: string;
  asOfQuarter: string;
  minWeight?: number;
}): Promise<SafmrIngestResult> {
  const buffer = await fs.readFile(params.xlsxPath);
  return runSafmrIngest({ ...params, buffer, minWeight: params.minWeight ?? 0.2 });
}
