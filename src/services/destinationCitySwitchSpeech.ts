/**
 * Speech-Struktur für Zielstadt-Wechsel — kein Script, Stadt/Name aus Kontext.
 */

export type DestinationSwitchIntent = 'hotel' | 'research';

export function destinationSwitchSpeech(opts: {
  cityName: string;
  activeName?: string | null;
  firstName?: string | null;
  intent?: DestinationSwitchIntent;
}): string {
  const city = (opts.cityName || '').trim();
  const name = (opts.firstName || '').trim();
  const hey = name ? `Hey ${name}, ` : '';
  if (opts.intent === 'hotel') {
    return `${hey}bitte wechsle zu ${city}, damit ich für dich nach dem passenden Hotel suchen kann. Das Fenster ist oben.`;
  }
  const active = (opts.activeName || '').trim();
  if (active) {
    return `${hey}du bist gerade bei ${active}, fragst aber nach ${city}. Für die Recherche in ${city} wechsle bitte dorthin — das Fenster ist oben.`;
  }
  return `${hey}für ${city} recherchiere ich besser, wenn wir auf ${city} wechseln. Das Fenster ist oben.`;
}
