/**
 * GTM3 Stage 5.5: HUD USPS Crosswalk API client.
 * Fetches ZIP↔CBSA (type=3) and ZIP↔Tract (type=1) from HUD's API so we don't require manual CSV download.
 * Docs: https://www.huduser.gov/portal/dataset/uspszip-api.html
 * Requires HUD_API_KEY (Bearer token from https://www.huduser.gov/hudapi/public/login).
 */

import type { ZipCbsaRow, ZipTractRow } from './sense-cbsa-hud-ingest';

const HUD_USPS_BASE = 'https://www.huduser.gov/hudapi/public/usps';

const normalizeZip = (s: string): string => String(s).replace(/\D/g, '').padStart(5, '0').slice(0, 5);
/** CBSA canonical form: digits only, leading zeros stripped so 030460 and 30460 match. */
const canonicalCbsa = (s: string): string => {
  const n = String(s).replace(/\D/g, '').trim();
  return n.replace(/^0+/, '') || '0';
};
const normalizeTractId = (s: string): string => String(s).replace(/\D/g, '').padStart(11, '0').slice(0, 11);
const parseNum = (v: unknown): number => {
  const n = Number(typeof v === 'string' ? v.replace(/,/g, '') : v);
  return Number.isFinite(n) ? n : 0;
};

type ApiResult = { geoid: string; zip?: string; res_ratio?: number; tot_ratio?: number; [k: string]: unknown };
type ApiDataItem = { input?: string; zip?: string; results?: ApiResult[]; [k: string]: unknown };

function getZipFromResult(r: ApiResult, parentZip: string): string {
  const raw = r as Record<string, unknown>;
  if (r.zip != null) return normalizeZip(String(r.zip));
  if (raw.zip_code != null) return normalizeZip(String(raw.zip_code));
  if (raw.ZIP != null) return normalizeZip(String(raw.ZIP));
  return parentZip;
}

/** US FIPS state codes are 01-56; reject state "00" to avoid wrong column (e.g. row index). */
function looksLikeValidTractGeoid(digits: string): boolean {
  if (digits.length !== 11) return false;
  const state = digits.slice(0, 2);
  return state !== '00' && parseInt(state, 10) >= 1 && parseInt(state, 10) <= 56;
}

/**
 * Get 11-digit tract GEOID from a type-12 (zip-tract) result.
 * Prefer "geoid"/"GEOID" per HUD docs. Fall back to "tract"/"TRACT" only when the value
 * is 11 digits and looks like a valid FIPS GEOID (state 01-56); never pad or accept state "00".
 */
function getTractFromZipTractResult(r: Record<string, unknown>): string {
  const candidates = [r.geoid, r.GEOID, r.tract, r.TRACT];
  for (const raw of candidates) {
    if (raw == null) continue;
    const digits = String(raw).replace(/\D/g, '');
    const id = digits.length >= 11 ? digits.slice(0, 11) : '';
    if (id && looksLikeValidTractGeoid(id)) return id;
  }
  return '';
}

async function fetchHudUsps(
  apiKey: string,
  type: number,
  query: string,
  year?: number,
  quarter?: number
): Promise<ApiDataItem | ApiDataItem[]> {
  const params = new URLSearchParams({ type: String(type), query });
  if (year != null) params.set('year', String(year));
  if (quarter != null) params.set('quarter', String(quarter));
  const url = `${HUD_USPS_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HUD USPS API ${res.status}: ${text || res.statusText}`);
  }
  const body = await res.json();
  const data = body?.data ?? body;
  if (data == null) throw new Error('HUD USPS API: missing data in response');
  return data;
}

/**
 * Flatten API response to rows. Handles:
 * - Single object with results[] where each result has zip + geoid or cbsa (query=All full file)
 * - Array of { input: zip, results: [ { geoid/cbsa, res_ratio } ] } (per-zip)
 * For type 10 (zip-cbsa), HUD may return the CBSA code in "cbsa" or "geoid" depending on version.
 */
function flattenZipCbsa(data: ApiDataItem | ApiDataItem[]): ZipCbsaRow[] {
  const rows: ZipCbsaRow[] = [];
  const items = Array.isArray(data) ? data : [data];
  for (const item of items) {
    const parentZip = item.input != null ? normalizeZip(String(item.input)) : (item.zip != null ? normalizeZip(String(item.zip)) : '');
    const results = Array.isArray(item.results) ? item.results : [];
    for (const r of results) {
      const zip = getZipFromResult(r, parentZip);
      const cbsaRaw = (r as Record<string, unknown>).cbsa ?? r.geoid;
      const cbsa = cbsaRaw != null ? canonicalCbsa(String(cbsaRaw)) : '';
      const res_ratio = parseNum(r.res_ratio ?? r.tot_ratio);
      if (zip.length === 5 && cbsa) {
        rows.push({ zip, cbsa, res_ratio });
      }
    }
    if (results.length === 0 && parentZip.length === 5) {
      const r = item as ApiResult;
      const cbsaRaw = (r as Record<string, unknown>).cbsa ?? r.geoid;
      if (cbsaRaw != null) {
        const cbsa = canonicalCbsa(String(cbsaRaw));
        const res_ratio = parseNum(r.res_ratio ?? r.tot_ratio);
        rows.push({ zip: parentZip, cbsa, res_ratio });
      }
    }
  }
  return rows;
}

/**
 * Normalize type-12 response so we always have an array of { input?: string, results: array }.
 * HUD may return: array of { input: zip, results: [...] }; or object keyed by ZIP; or single object
 * with results[]; or flat array of rows { zip, geoid, res_ratio } (no nested results).
 */
function normalizeZipTractPayload(data: ApiDataItem | ApiDataItem[]): ApiDataItem[] {
  if (Array.isArray(data)) {
    const first = data[0] as Record<string, unknown> | undefined;
    const hasFlatRows = first != null && !Array.isArray(first) && (first.geoid != null || first.GEOID != null || first.tract != null) && (first.zip != null || (first as ApiDataItem).input != null);
    if (hasFlatRows) {
      return [{ results: data as ApiResult[] }];
    }
    return data;
  }
  const obj = data as Record<string, unknown>;
  if (obj == null || typeof obj !== 'object') return [];
  if (Array.isArray(obj.results)) return [obj as ApiDataItem];
  const items: ApiDataItem[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const zip = normalizeZip(String(key));
    if (zip.length === 5 && Array.isArray(val)) {
      items.push({ input: zip, results: val });
    }
  }
  return items.length > 0 ? items : [obj as ApiDataItem];
}

/**
 * Flatten ZIP-Tract (type 12) response. Per HUD docs, use only "geoid" for the tract GEOID.
 */
function flattenZipTract(data: ApiDataItem | ApiDataItem[]): ZipTractRow[] {
  const rows: ZipTractRow[] = [];
  const items = normalizeZipTractPayload(data);
  for (const item of items) {
    const parentZip = item.input != null ? normalizeZip(String(item.input)) : (item.zip != null ? normalizeZip(String(item.zip)) : '');
    const results = Array.isArray(item.results) ? item.results : [];
    for (const r of results) {
      const raw = r as Record<string, unknown>;
      const zip = getZipFromResult(r, parentZip);
      const tract_id = getTractFromZipTractResult(raw);
      const res_ratio = parseNum(raw.res_ratio ?? raw.tot_ratio ?? raw.RES_RATIO ?? raw.TOT_RATIO);
      if (zip.length === 5 && tract_id.length === 11 && res_ratio >= 0) {
        rows.push({ zip, tract_id, res_ratio });
      }
    }
    if (results.length === 0 && parentZip.length === 5) {
      const r = item as Record<string, unknown>;
      const tract_id = getTractFromZipTractResult(r);
      if (tract_id.length === 11) {
        const res_ratio = parseNum(r.res_ratio ?? r.tot_ratio ?? r.RES_RATIO ?? r.TOT_RATIO);
        if (res_ratio >= 0) {
          rows.push({ zip: parentZip, tract_id, res_ratio });
        }
      }
    }
  }
  return rows;
}

/**
 * Fetch full ZIP→CBSA crosswalk from HUD USPS API (type=3, query=All).
 * Optional year/quarter; default is latest.
 */
export async function fetchZipCbsaFromApi(
  apiKey: string,
  options?: { year?: number; quarter?: number }
): Promise<ZipCbsaRow[]> {
  const data = await fetchHudUsps(apiKey, 3, 'All', options?.year, options?.quarter);
  const rows = flattenZipCbsa(data);
  if (rows.length === 0) throw new Error('HUD USPS API: no ZIP-CBSA rows returned (check type=3 & query=All)');
  return rows;
}

/**
 * Fetch the full national ZIP→Tract bulk dataset (type=1, query=All).
 * Returns all rows; caller is responsible for filtering to relevant tracts.
 * Uses HUD's latest available quarter by default.
 */
export async function fetchZipTractBulk(apiKey: string): Promise<ZipTractRow[]> {
  const data = await fetchHudUsps(apiKey, 1, 'All');
  const rows = flattenZipTract(data);
  if (rows.length === 0) {
    throw new Error('HUD USPS API: no ZIP-Tract rows from type=1 query=All');
  }
  return rows;
}

/**
 * Fetch ZIPs for a single tract from HUD USPS API (type=6, tract-zip).
 * Query = 11-digit tract GEOID; returns rows with zip + res_ratio for that tract.
 * Use to verify API or as fallback when type=12 query=All returns no rows.
 */
export async function fetchZipCodesByTract(
  apiKey: string,
  tractGeoid: string,
  options?: { year?: number; quarter?: number }
): Promise<ZipTractRow[]> {
  const digits = String(tractGeoid).replace(/\D/g, '');
  const query = digits.length === 11 ? digits : digits.padStart(11, '0').slice(0, 11);
  const data = await fetchHudUsps(apiKey, 6, query, options?.year, options?.quarter);
  const items = Array.isArray(data) ? data : [data];
  const rows: ZipTractRow[] = [];
  for (const item of items) {
    const results = Array.isArray(item.results) ? item.results : [];
    for (const r of results) {
      const raw = r as Record<string, unknown>;
      const zipRaw = raw.geoid ?? raw.zip ?? raw.ZIP ?? raw.zip_code;
      const zipNorm = zipRaw != null ? normalizeZip(String(zipRaw)) : '';
      const res_ratio = parseNum(raw.res_ratio ?? raw.tot_ratio ?? raw.RES_RATIO ?? raw.TOT_RATIO);
      if (zipNorm.length === 5 && res_ratio >= 0) {
        rows.push({ zip: zipNorm, tract_id: query, res_ratio });
      }
    }
  }
  return rows;
}

/**
 * Fetch full ZIP→Tract crosswalk from HUD USPS API.
 * Tries type=1 query=All first; HUD may return 404 for that.
 * On 404 or empty, falls back to per-tract fetches (type=6) when tractIds are provided.
 */
export async function fetchZipTractFromApi(
  apiKey: string,
  options?: { year?: number; quarter?: number; tractIds?: string[] }
): Promise<ZipTractRow[]> {
  let rows: ZipTractRow[] = [];
  try {
    const data = await fetchHudUsps(apiKey, 1, 'All', options?.year, options?.quarter);
    rows = flattenZipTract(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404') || msg.includes('No data found')) {
      rows = [];
    } else {
      throw err;
    }
  }
  if (rows.length > 0) return rows;
  const tractIds = options?.tractIds;
  if (tractIds?.length) {
    const all: ZipTractRow[] = [];
    for (const tractId of tractIds) {
      const digits = String(tractId).replace(/\D/g, '');
      const id = digits.length >= 11 ? digits.slice(0, 11) : digits.padStart(11, '0').slice(0, 11);
      if (!looksLikeValidTractGeoid(id)) continue;
      try {
        const part = await fetchZipCodesByTract(apiKey, id, options);
        all.push(...part);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || msg.includes('No data found')) {
          continue; // tract has no HUD data for this period; skip it
        }
        throw err;
      }
    }
    if (all.length > 0) return all;
  }
  throw new Error(
    tractIds?.length
      ? 'HUD USPS API: no ZIP-Tract rows from per-tract fallback'
      : 'HUD USPS API: no ZIP-Tract rows (type=1 All returned empty; provide tractIds for per-tract fallback)'
  );
}
