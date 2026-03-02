/**
 * Minimal Census TIGERweb API service for Sense pipeline.
 * Provides getTractsByCounty for census-cbsa-tracts (CBSA tract set from Census).
 */

export interface CensusTractData {
  tractId: string;
  name?: string;
  stateCode?: string;
  countyCode?: string;
  tractCode?: string;
  geometry?: unknown;
  landAreaSqM?: number;
  waterAreaSqM?: number;
  areaSqKm?: number;
}

export interface CensusApiResponse {
  features: Array<{
    properties: Record<string, unknown>;
    geometry: unknown;
  }>;
}

export class CensusApiService {
  private readonly baseUrl = 'https://tigerweb.geo.census.gov/arcgis/rest/services';

  private async getJson<T>(
    url: string,
    params?: Record<string, string | number | boolean>,
    timeoutMs: number = 30000,
  ): Promise<T> {
    const query = params
      ? `?${new URLSearchParams(
          Object.entries(params).map(([key, value]) => [key, String(value)]),
        ).toString()}`
      : '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${url}${query}`, {
        method: 'GET',
        headers: { 'User-Agent': 'REcontrol-sense-census/1.0' },
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = new Error(`Request failed with status ${response.status}`);
        (err as Error & { status?: number }).status = response.status;
        throw err;
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getTractsByCounty(countyFips: string): Promise<CensusTractData[]> {
    const stateFips = countyFips.slice(0, 2);
    const countyCode = countyFips.slice(2, 5);

    const url = `${this.baseUrl}/TIGERweb/tigerWMS_Census2020/MapServer/6/query`;

    const params = {
      where: `COUNTY='${countyCode}' AND STATE='${stateFips}'`,
      outFields: 'GEOID,NAME,STATE,COUNTY,TRACT,AREALAND,AREAWATER',
      f: 'geojson',
      returnGeometry: true,
      outSR: 4326,
    };

    const response = await this.getJson<CensusApiResponse>(url, params);

    if (!response.features) {
      throw new Error(`No tract data returned for county ${countyFips}`);
    }

    return response.features.map((feature) => {
      const props = feature.properties;
      const landArea = Number(props.AREALAND) || 0;
      const waterArea = Number(props.AREAWATER) || 0;

      return {
        tractId: props.GEOID as string,
        name: (props.NAME as string) || `Tract ${props.TRACT}`,
        stateCode: props.STATE as string,
        countyCode: props.COUNTY as string,
        tractCode: props.TRACT as string,
        geometry: feature.geometry,
        landAreaSqM: landArea,
        waterAreaSqM: waterArea,
        areaSqKm: (landArea + waterArea) / 1_000_000,
      };
    });
  }
}
