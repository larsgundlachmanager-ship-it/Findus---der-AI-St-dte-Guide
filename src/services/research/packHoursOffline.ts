/**
 * Öffnungszeiten / Menü-Hinweise aus Pack (offline) — ohne Web.
 * Nutzt POI-Fakten; Trust über sourceTrust (Pack = medium–high).
 */

import { getAllPois, getFactsForPoi } from '../../db/database';
import { scoreSourceTrust, formatTrustedFactLine } from '../research/sourceTrust';

export type PackHoursAnswer = {
  placeName: string;
  poiId: number;
  line: string;
  trust: number;
  source: 'pack_fact';
};

const HOURS_RE =
  /\b(öffnung|oeffnung|geöffnet|geoeffnet|geschlossen|mo[–\-]so|mo\s*[-–]|di\s*[-–]|uhr|opens?|closes?|opening|hours|von\s+\d|bis\s+\d|\d{1,2}[:.]\d{2})\b/iu;

const MENU_RE =
  /\b(speisekarte|menü|menu|gericht|frühstück|fruehstueck|mittagskarte|abendkarte|karte\s+bietet)\b/iu;

function scorePackLine(text: string, kind: 'hours' | 'menu'): number {
  return scoreSourceTrust({
    hasTime: /\d{1,2}[:.]\d{2}/.test(text),
    detailLen: text.length,
    sourceHint: kind === 'hours' ? 'opening_hours pack' : 'menu pack',
    confidence: text.length >= 40 ? 'high' : 'medium',
  });
}

/**
 * Offline-Antwort zu Öffnungszeiten/Menü aus Stadt-Pack.
 * null = Pack hat nichts Belastbares → Caller darf Web nutzen.
 */
export async function lookupPackHoursOrMenu(opts: {
  userText: string;
  placeNameHint?: string | null;
}): Promise<PackHoursAnswer | null> {
  const t = opts.userText.replace(/\s+/g, ' ').trim();
  const wantHours =
    HOURS_RE.test(t) || /\b(wann\s+hat|hat\s+.+auf|noch\s+offen)\b/iu.test(t);
  const wantMenu = MENU_RE.test(t);
  if (!wantHours && !wantMenu) return null;

  const hint = (opts.placeNameHint || '').toLowerCase().trim();
  const pois = await getAllPois();
  const candidates = hint
    ? pois.filter((p) => p.name.toLowerCase().includes(hint.slice(0, 24)))
    : pois;

  let best: PackHoursAnswer | null = null;

  for (const poi of candidates.slice(0, 80)) {
    const facts = await getFactsForPoi(poi.id);
    for (const f of facts) {
      const blob = (f.fact_text ?? '').trim();
      if (blob.length < 12) continue;
      const isHours = HOURS_RE.test(blob);
      const isMenu = MENU_RE.test(blob);
      if (wantHours && !isHours) continue;
      if (wantMenu && !wantHours && !isMenu) continue;
      if (!isHours && !isMenu) continue;
      const trust = scorePackLine(blob, isHours ? 'hours' : 'menu');
      const line = formatTrustedFactLine({
        label: isHours ? 'Öffnungszeiten' : 'Angebot',
        value: blob.replace(/\s+/g, ' ').trim().slice(0, 220),
        trust,
      });
      if (!best || trust > best.trust) {
        best = {
          placeName: poi.name,
          poiId: poi.id,
          line: `${poi.name}: ${line}`,
          trust,
          source: 'pack_fact',
        };
      }
    }
  }

  return best && best.trust >= 0.4 ? best : null;
}
