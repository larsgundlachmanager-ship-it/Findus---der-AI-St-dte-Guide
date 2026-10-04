/**
 * Ziel-Hero: ansprechende Landmarken statt Fernsehturm/Ugly-Default.
 * Stadt-agnostisch mit bekannten Scenic-Alts; Ablehnung unattraktiver Wiki-Thumbs.
 */

/** Unattraktive / „Tech-Turm“-Motive — nicht als Reise-Hero. */
export function isUnappealingDestPhotoUrl(url: string | null | undefined): boolean {
  const u = (url || '').toLowerCase();
  if (!u) return false;
  return /zizkov|žižkov|%c5%bei%c5%bekov|fernsehturm|television.?tower|tv.?tower|tv_tower|vysilac|vys[ií]la|radio.?tower|funkmast|sendemast|cell.?tower|transmission.?tower/.test(
    u,
  );
}

/** Landmarken-Titel vor generischem Stadtnamen (Wiki DE/EN). */
export function scenicWikiAlts(placeName: string): string[] {
  const raw = (placeName || '').trim();
  const n = raw.toLowerCase();
  const out: string[] = [];
  const push = (...xs: string[]) => {
    for (const x of xs) {
      const t = x.trim();
      if (t && !out.some((y) => y.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  };

  if (/prag|prague|praha/.test(n)) {
    push(
      'Karlsbrücke',
      'Charles Bridge',
      'Prager Burg',
      'Prague Castle',
      'Altstädter Ring',
      'Old Town Square (Prague)',
      'Prag',
      'Prague',
    );
  } else if (/budapest|ungarn/.test(n) && /budapest/.test(n)) {
    push('Parlament (Budapest)', 'Hungarian Parliament Building', 'Kettenbrücke (Budapest)', 'Budapest');
  } else if (/berlin/.test(n)) {
    push('Brandenburger Tor', 'Brandenburg Gate', 'Berliner Dom', 'Berlin');
  } else if (/wien|vienna/.test(n)) {
    push('Stephansdom', 'Schönbrunn', 'Vienna', 'Wien');
  } else if (/amsterdam/.test(n)) {
    push('Grachtengordel', 'Dam Square', 'Amsterdam');
  } else if (/barcelona/.test(n)) {
    push('Sagrada Família', 'Park Güell', 'Barcelona');
  } else if (/lissabon|lisbon|lisboa/.test(n)) {
    push('Torre de Belém', 'Praça do Comércio', 'Lisbon', 'Lissabon');
  } else if (/rom|rome/.test(n) && !/strom/.test(n)) {
    push('Kolosseum', 'Colosseum', 'Pantheon', 'Rom', 'Rome');
  } else if (/paris/.test(n)) {
    push('Eiffelturm', 'Eiffel Tower', 'Notre-Dame de Paris', 'Paris');
  } else {
    push(`${raw} Altstadt`, `${raw} skyline`, `${raw} castle`, `${raw} old town`, raw);
  }

  return out.slice(0, 10);
}
