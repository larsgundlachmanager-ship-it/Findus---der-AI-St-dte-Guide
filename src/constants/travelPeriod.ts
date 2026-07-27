/** Voreinstellungen für den Reisezeitraum (Express & Profil). */
export type TravelPeriodPreset =
  | 'jetzt'
  | 'wochenende'
  | '2tage'
  | 'woche'
  | 'custom';

export const TRAVEL_PERIOD_PRESETS: {
  id: TravelPeriodPreset;
  label: string;
  value: string;
}[] = [
  { id: 'jetzt', label: 'Jetzt', value: 'Jetzt' },
  { id: 'wochenende', label: 'Wochenende', value: 'Wochenende' },
  { id: '2tage', label: '2 Tage', value: '2 Tage' },
  { id: 'woche', label: 'Eine Woche', value: 'Eine Woche' },
  { id: 'custom', label: 'Benutzerdefiniert', value: '' },
];

export function matchTravelPeriodPreset(
  value: string | undefined | null,
): TravelPeriodPreset {
  const v = (value ?? '').trim();
  if (!v) return 'custom';
  const hit = TRAVEL_PERIOD_PRESETS.find(
    (p) => p.id !== 'custom' && p.value.toLowerCase() === v.toLowerCase(),
  );
  return hit?.id ?? 'custom';
}
