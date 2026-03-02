/**
 * Tract geometry provider interface and implementations
 *
 * Abstracts fetching tract boundary geometries from various sources.
 */

export type MultiPolygon = { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface TractGeometryProvider {
  /**
   * Fetch geometry for a single tract by tract_id (GEOID)
   * @param tractId - Census tract GEOID (e.g., "21029000100")
   * @returns GeoJSON geometry (MultiPolygon) or null if not found
   */
  getTractGeometry(tractId: string): Promise<MultiPolygon | null>;
}

/**
 * Census TIGERweb provider implementation
 *
 * Uses Census Bureau TIGERweb REST API:
 * https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/6/query
 *
 * Layer ID 6 = Census Tracts
 * Vintage: Census 2020
 */
export class CensusTigerGeometryProvider implements TractGeometryProvider {
  private readonly baseUrl =
    'https://tigerweb.geo.census.gov/arcgis/rest/services';
  private readonly vintage = '2022'; // Census data year

  async getTractGeometry(
    tractId: string
  ): Promise<MultiPolygon | null> {
    if (!tractId || tractId.length !== 11) {
      console.warn(`[TractGeometry] Invalid tract_id format: ${tractId}`);
      return null;
    }

    const url = `${this.baseUrl}/TIGERweb/tigerWMS_Census2020/MapServer/6/query`;

    const params = {
      where: `GEOID='${tractId}'`,
      outFields: 'GEOID',
      f: 'geojson',
      returnGeometry: true,
      outSR: 4326, // WGS84 coordinate system
    };

    try {
      const query = new URLSearchParams(
        Object.entries(params).map(([key, value]) => [key, String(value)])
      );
      const response = await fetch(`${url}?${query.toString()}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'REcontrol-sense/1.0 Tract Geometry Service',
        },
      });

      if (!response.ok) {
        console.warn(
          `[TractGeometry] Failed to fetch tract ${tractId}: HTTP ${response.status}`
        );
        return null;
      }

      const data = (await response.json()) as {
        features?: Array<{
          geometry?: MultiPolygon | { type: 'Polygon'; coordinates: number[][][] };
        }>;
      };

      if (
        !data.features ||
        data.features.length === 0 ||
        !data.features[0].geometry
      ) {
        console.warn(`[TractGeometry] No geometry found for tract ${tractId}`);
        return null;
      }

      const geom = data.features[0].geometry;

      // Ensure MultiPolygon (wrap Polygon if needed)
      if (geom.type === 'Polygon') {
        return {
          type: 'MultiPolygon',
          coordinates: [geom.coordinates],
        };
      }

      if (geom.type === 'MultiPolygon') {
        return geom;
      }

      console.warn(
        `[TractGeometry] Unexpected geometry type for tract ${tractId}: ${(geom as { type: string }).type}`
      );
      return null;
    } catch (error) {
      console.error(
        `[TractGeometry] Error fetching tract ${tractId}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      return null;
    }
  }
}

/**
 * Default provider instance (Census TIGER)
 */
export const defaultTractGeometryProvider: TractGeometryProvider =
  new CensusTigerGeometryProvider();
