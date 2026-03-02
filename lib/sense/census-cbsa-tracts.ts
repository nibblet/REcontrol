/**
 * Fetch counties and tracts for a CBSA from the Census Bureau API.
 * Used by build-market-tracts so the tract set is Census-authoritative; HUD is then only for ZIP→tract crosswalk.
 * Census geography 313: metropolitan statistical area/micropolitan statistical area › state › county.
 */

const CENSUS_BASE = 'https://api.census.gov/data';
const ACS_YEAR = 2023;
const ACS_SURVEY = 'acs/acs5';

export type CensusCbsaTractsResult = {
  tractIds: string[];
  countyGeoids: string[];
  countiesInCbsa: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MSA_IN = 'metropolitan statistical area/micropolitan statistical area';
const STATE_IN = 'state (or part)';
/** Minimal ACS variable so get= is valid; geography columns are added by the API. */
const MIN_GET = 'NAME,B01001_001E';

/** Find column index (Census returns geography names like "state (or part)"). */
function findGeoCol(header: string[], ...names: string[]): number {
  for (const name of names) {
    const i = header.findIndex((h) => h === name || h.includes(name));
    if (i !== -1) return i;
  }
  return -1;
}

/**
 * Fetch (state, county) FIPS for all counties in a CBSA.
 * Census geography 313 requires state in the hierarchy: we get states in CBSA (311), then counties per state (313).
 */
export async function fetchCountiesInCbsa(
  cbsaCode: string,
  apiKey: string,
): Promise<Array<{ state: string; county: string }>> {
  const cbsaCanon = cbsaCode.replace(/\D/g, '').trim().replace(/^0+/, '') || '0';

  // 311: states in this CBSA (get= needs valid ACS variable; geo code returned as "state (or part)")
  const stateParams = new URLSearchParams();
  stateParams.set('get', MIN_GET);
  stateParams.set('for', `${STATE_IN}:*`);
  stateParams.set('in', `${MSA_IN}:${cbsaCanon}`);
  stateParams.set('key', apiKey);
  const stateUrl = `${CENSUS_BASE}/${ACS_YEAR}/${ACS_SURVEY}?${stateParams.toString()}`;
  const stateRes = await fetch(stateUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'recontrol-sense-census-cbsa/1.0' },
  });
  if (!stateRes.ok) {
    const text = await stateRes.text();
    throw new Error(
      `Census API states-in-CBSA failed (${stateRes.status}): ${text || stateRes.statusText}`,
    );
  }
  const stateData = (await stateRes.json()) as string[][];
  if (!Array.isArray(stateData) || stateData.length < 2) {
    return [];
  }
  const [stateHeader, ...stateRows] = stateData;
  const stateCol = findGeoCol(stateHeader, 'state (or part)', 'state');
  if (stateCol === -1) return [];
  const states = stateRows.map((r) => String(r[stateCol] ?? '').padStart(2, '0').slice(0, 2));

  const counties: Array<{ state: string; county: string }> = [];
  for (const state of states) {
    await sleep(150);
    // 313: counties in this CBSA + state (single "in" with space-separated hierarchy per Census examples)
    const countyParams = new URLSearchParams();
    countyParams.set('get', MIN_GET);
    countyParams.set('for', 'county:*');
    countyParams.set('in', `${MSA_IN}:${cbsaCanon} ${STATE_IN}:${state}`);
    countyParams.set('key', apiKey);
    const countyUrl = `${CENSUS_BASE}/${ACS_YEAR}/${ACS_SURVEY}?${countyParams.toString()}`;
    const countyRes = await fetch(countyUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'recontrol-sense-census-cbsa/1.0' },
    });
    if (!countyRes.ok) {
      const text = await countyRes.text();
      throw new Error(
        `Census API counties-in-CBSA failed (${countyRes.status}) for state ${state}: ${text || countyRes.statusText}`,
      );
    }
    const countyData = (await countyRes.json()) as string[][];
    if (!Array.isArray(countyData) || countyData.length < 2) continue;
    const [countyHeader, ...countyRows] = countyData;
    const stateIdx = findGeoCol(countyHeader, 'state (or part)', 'state');
    const countyIdx = findGeoCol(countyHeader, 'county');
    if (stateIdx === -1 || countyIdx === -1) continue;
    for (const row of countyRows) {
      counties.push({
        state: String(row[stateIdx] ?? '').padStart(2, '0').slice(0, 2),
        county: String(row[countyIdx] ?? '').padStart(3, '0').slice(0, 3),
      });
    }
  }
  return counties;
}

/**
 * Fetch all tract GEOIDs (and county GEOIDs) for a CBSA: counties from Census geography 313,
 * then tracts per county from CensusApiService.getTractsByCounty.
 */
export async function fetchTractIdsForCbsa(
  cbsaCode: string,
  apiKey: string,
): Promise<CensusCbsaTractsResult> {
  const { CensusApiService } = await import('@/lib/censusApiService');
  const censusApi = new CensusApiService();

  const counties = await fetchCountiesInCbsa(cbsaCode, apiKey);
  if (counties.length === 0) {
    return { tractIds: [], countyGeoids: [], countiesInCbsa: 0 };
  }

  const countyGeoids = [
    ...new Set(
      counties.map((c) => `${c.state}${c.county}`.padStart(5, '0').slice(0, 5)),
    ),
  ];
  const tractIdsSet = new Set<string>();

  for (const c of counties) {
    const countyFips = `${c.state}${c.county}`;
    await sleep(200);
    const tracts = await censusApi.getTractsByCounty(countyFips);
    for (const t of tracts) {
      if (t.tractId && t.tractId.length === 11) {
        tractIdsSet.add(t.tractId);
      }
    }
  }

  return {
    tractIds: [...tractIdsSet],
    countyGeoids,
    countiesInCbsa: counties.length,
  };
}
