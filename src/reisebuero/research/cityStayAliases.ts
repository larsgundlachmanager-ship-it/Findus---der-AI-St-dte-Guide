/**
 * DE↔EN Stadt-Aliase für Stay-Suche (Krakau/Krakow, Lissabon/Lisbon, …).
 */

export function cityStayQueryAliases(city: string): string[] {
  const c = (city || '').trim();
  if (!c) return [];
  const lower = c.toLowerCase();
  const map: Record<string, string[]> = {
    krakau: ['Krakau', 'Krakow', 'Kraków', 'Cracow'],
    kraków: ['Kraków', 'Krakow', 'Krakau', 'Cracow'],
    krakow: ['Krakow', 'Kraków', 'Krakau', 'Cracow'],
    cracow: ['Cracow', 'Krakow', 'Kraków', 'Krakau'],
    warschau: ['Warschau', 'Warsaw', 'Warszawa'],
    warsaw: ['Warsaw', 'Warschau', 'Warszawa'],
    mailand: ['Mailand', 'Milan', 'Milano'],
    florenz: ['Florenz', 'Florence', 'Firenze'],
    rom: ['Rom', 'Rome', 'Roma'],
    neapel: ['Neapel', 'Naples', 'Napoli'],
    venedig: ['Venedig', 'Venice', 'Venezia'],
    prag: ['Prag', 'Prague', 'Praha'],
    wien: ['Wien', 'Vienna'],
    brüssel: ['Brüssel', 'Brussels', 'Bruxelles'],
    lissabon: ['Lissabon', 'Lisbon', 'Lisboa'],
    'st. julian': ["St. Julian's", 'St Julians', 'San Ġiljan', 'Malta St Julians'],
    "st. julian's": ["St. Julian's", 'St Julians', 'San Ġiljan'],
  };
  const hit = map[lower] || map[lower.replace(/\s+/g, ' ')];
  if (hit) return [...new Set(hit)];
  return [c];
}
