/**
 * Einheitliche Transit-Adapter: Live-Abfahrten je Stadt/Verbund.
 */

export type AdapterDeparture = {
  line: string;
  direction: string;
  when: Date;
  plannedWhen: Date | null;
  delaySec: number | null;
  cancelled: boolean;
  planned: boolean;
  platform?: string | null;
};

export type TransitAdapterKind =
  | 'db_rest'
  | 'hafas'
  | 'gtfs_rt'
  | 'delijn'
  | 'transitous'
  | 'takt';

export type TransitAdapter = {
  kind: TransitAdapterKind;
  label: string;
  fetchDepartures: (opts: {
    stopId: string;
    directionHint?: string | null;
    limit?: number;
  }) => Promise<AdapterDeparture[] | null>;
};
