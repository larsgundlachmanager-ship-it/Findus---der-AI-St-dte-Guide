/**
 * Mobility-Config aus Stadt-Pack (_mobility).
 */

export type PackParkingHint = {
  name: string;
  lat: number;
  lng: number;
  type?: 'bike_rack' | 'car' | 'mixed';
  pricing?: 'free' | 'paid' | 'unknown';
};

export type PackMobilityConfig = {
  bike_share?: {
    providers?: Array<'nextbike' | 'call_a_bike'>;
    nextbike_city_id?: string | null;
  };
  parking?: {
    parkopedia_enabled?: boolean;
    hint_spots?: PackParkingHint[];
  };
};

let config: PackMobilityConfig | null = null;

export function clearMobilityPackConfig(): void {
  config = null;
}

export function setMobilityPackConfig(
  cfg: PackMobilityConfig | null | undefined,
): void {
  config = cfg ?? null;
}

export function getMobilityPackConfig(): PackMobilityConfig | null {
  return config;
}
