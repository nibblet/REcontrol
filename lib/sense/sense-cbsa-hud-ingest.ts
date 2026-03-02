/**
 * GTM3 Stage 5.5: HUD-USPS crosswalk helpers for any CBSA.
 * Parse ZIP↔CBSA and ZIP↔Tract CSVs; derive tract set per CBSA.
 * Residential ratio threshold: >= 0.05 (tracts with meaningful share of CBSA's residential addresses).
 */

import * as fs from 'fs';

/** Minimum residential ratio (ZIP→Tract) to include a tract in a CBSA. Documented threshold. */
export const HUD_RESIDENTIAL_RATIO_MIN = 0.05;

export type ZipCbsaRow = { zip: string; cbsa: string; res_ratio: number };
export type ZipTractRow = { zip: string; tract_id: string; res_ratio: number };

const normalizeZip = (s: string): string => String(s).replace(/\D/g, '').padStart(5, '0').slice(0, 5);
/** Canonical CBSA: digits only, leading zeros stripped so 030460 and 30460 match (align with HUD API). */
const canonicalCbsa = (s: string): string => {
  const n = String(s).replace(/\D/g, '').trim();
  return n.replace(/^0+/, '') || '0';
};
const parseNum = (s: string | undefined): number => {
  const n = Number(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Build 11-digit tract GEOID from state (2) + county (3) + tract (6). */
function buildTractId(state: string, county: string, tract: string): string {
  const s = String(state).replace(/\D/g, '').padStart(2, '0').slice(0, 2);
  const c = String(county).replace(/\D/g, '').padStart(3, '0').slice(0, 3);
  const t = String(tract).replace(/\D/g, '').padStart(6, '0').slice(0, 6);
  return `${s}${c}${t}`;
}

/** Parse CSV line handling quoted fields. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/** Find column index by possible headers (case-insensitive, strip non-alphanumeric). */
function findCol(header: string[], ...candidates: string[]): number {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const set = new Set(candidates.map(norm));
  for (let i = 0; i < header.length; i++) {
    if (set.has(norm(header[i]))) return i;
  }
  return -1;
}

/**
 * Load HUD ZIP→CBSA crosswalk from CSV.
 * Expected columns: ZIP (or ZCTA), CBSA, RES_RATIO or TOT_RATIO.
 */
export function loadZipCbsaCsv(filePath: string): ZipCbsaRow[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const zipIdx = findCol(header, 'ZIP', 'ZCTA', 'ZIP_CODE', 'ZIPCODE');
  const cbsaIdx = findCol(header, 'CBSA', 'CBSACODE');
  const ratioIdx = findCol(header, 'RES_RATIO', 'RESRATIO', 'TOT_RATIO', 'TOTRATIO');
  if (zipIdx < 0 || cbsaIdx < 0 || ratioIdx < 0) {
    throw new Error(`ZIP-CBSA CSV missing required columns. Found: ${header.join(',')}`);
  }
  const rows: ZipCbsaRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const zip = normalizeZip(cells[zipIdx] ?? '');
    const cbsa = canonicalCbsa(cells[cbsaIdx] ?? '');
    const res_ratio = parseNum(cells[ratioIdx]);
    if (zip.length === 5 && cbsa) {
      rows.push({ zip, cbsa, res_ratio });
    }
  }
  return rows;
}

/**
 * Load HUD ZIP→Tract crosswalk from CSV.
 * Expected columns: ZIP, STATE/STATEFP, COUNTY/COUNTYFP, TRACT/TRACTCE (or GEOID), RES_RATIO/TOT_RATIO.
 */
export function loadZipTractCsv(filePath: string): ZipTractRow[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const zipIdx = findCol(header, 'ZIP', 'ZCTA', 'ZIP_CODE', 'ZIPCODE');
  const geoidIdx = findCol(header, 'GEOID', 'TRACT_GEOID', 'TRACTID', 'TRACT_ID');
  const stateIdx = findCol(header, 'STATE', 'STATEFP', 'STATE_FIPS', 'STATEFIPS');
  const countyIdx = findCol(header, 'COUNTY', 'COUNTYFP', 'COUNTY_FIPS', 'COUNTYFIPS');
  const tractIdx = findCol(header, 'TRACT', 'TRACTCE', 'TRACT_FIPS', 'TRACTFIPS');
  const ratioIdx = findCol(header, 'RES_RATIO', 'RESRATIO', 'TOT_RATIO', 'TOTRATIO');
  if (zipIdx < 0 || ratioIdx < 0) {
    throw new Error(`ZIP-Tract CSV missing ZIP or ratio. Found: ${header.join(',')}`);
  }
  const hasGeoid = geoidIdx >= 0;
  const hasTractParts = stateIdx >= 0 && countyIdx >= 0 && tractIdx >= 0;
  if (!hasGeoid && !hasTractParts) {
    throw new Error(`ZIP-Tract CSV needs GEOID or STATE+COUNTY+TRACT. Found: ${header.join(',')}`);
  }
  const rows: ZipTractRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const zip = normalizeZip(cells[zipIdx] ?? '');
    let tract_id: string;
    if (hasGeoid) {
      tract_id = String(cells[geoidIdx] ?? '').replace(/\D/g, '').padStart(11, '0').slice(0, 11);
    } else {
      tract_id = buildTractId(
        cells[stateIdx] ?? '',
        cells[countyIdx] ?? '',
        cells[tractIdx] ?? '',
      );
    }
    const res_ratio = parseNum(cells[ratioIdx]);
    if (zip.length === 5 && tract_id.length === 11 && res_ratio >= 0) {
      rows.push({ zip, tract_id, res_ratio });
    }
  }
  return rows;
}

/**
 * Derive set of tract_ids that belong to the given CBSA using ZIP→CBSA and ZIP→Tract.
 * A tract is included if any ZIP in the CBSA (with res_ratio >= ratioMin) maps to that tract
 * with tract-level res_ratio >= ratioMin.
 */
export function deriveTractsForCbsa(
  zipCbsaRows: ZipCbsaRow[],
  zipTractRows: ZipTractRow[],
  cbsaCode: string,
  ratioMin: number = HUD_RESIDENTIAL_RATIO_MIN,
): Set<string> {
  const zipsInCbsa = new Set<string>();
  for (const r of zipCbsaRows) {
    if (r.cbsa === cbsaCode && r.res_ratio >= ratioMin) {
      zipsInCbsa.add(r.zip);
    }
  }
  const tractIds = new Set<string>();
  for (const r of zipTractRows) {
    if (zipsInCbsa.has(r.zip) && r.res_ratio >= ratioMin) {
      tractIds.add(r.tract_id);
    }
  }
  return tractIds;
}
