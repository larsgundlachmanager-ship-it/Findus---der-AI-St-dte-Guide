/**
 * Speech-Struktur: Pack-Download vor In-Stadt-Recherche —
 * kein Script, Stadt/Name aus Kontext. Selected-Stadt bleibt (Modul 1).
 */

export type DestinationSwitchIntent = 'hotel' | 'research' | 'download';

export function destinationSwitchSpeech(opts: {
  cityName: string;
  activeName?: string | null;
  firstName?: string | null;
  intent?: DestinationSwitchIntent;
}): string {
  const city = (opts.cityName || '').trim();
  const name = (opts.firstName || '').trim();
  const hey = name ? `Hey ${name}, ` : '';
  // Download-Pflicht: Katalog-Pack existiert, fehlt auf dem Gerät
  if (
    opts.intent === 'download' ||
    opts.intent === 'hotel' ||
    opts.intent === 'research'
  ) {
    return `${hey}lad dir bitte zuerst den Datensatz für ${city} herunter — dann starte ich die Recherche. Das Fenster ist oben.`;
  }
  return `${hey}lad dir bitte zuerst den Datensatz für ${city} herunter — dann starte ich die Recherche. Das Fenster ist oben.`;
}
