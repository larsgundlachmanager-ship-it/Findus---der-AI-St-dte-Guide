/**
 * AGI-Gesetzbuch — 4 Architektur-Schichten (nie Monolith-Prompt).
 */

export type LawLayer = 'code' | 'agent' | 'ui' | 'background';

export type Module2Law = {
  no: number;
  layer: LawLayer;
  /** Agent-Intent(s) für Schicht agent — leer = global soft */
  agents?: string[];
  rule: string;
};

/**
 * Kritische Gesetze mit Schicht-Tag (Auszug + Kern; Rest nachladbar).
 * Vollständige 190 bleiben in findusLawRegistry — hier Schicht-SSOT für Modul 2.
 */
export const MODULE2_LAYERED_LAWS: readonly Module2Law[] = [
  { no: 1, layer: 'code', rule: 'Keine Adressen/PLZ/URLs im Audio außer explizit gefragt.' },
  { no: 4, layer: 'code', rule: 'TTS-Chunk max 600 Zeichen; Agent-Draft darf länger sein.' },
  { no: 12, layer: 'code', rule: 'Nie URLs vorlesen — auf Buttons verweisen.' },
  { no: 18, layer: 'code', rule: 'API >2s → Bridging/Filler Audio.' },
  { no: 36, layer: 'code', rule: 'Zero Hallucination — keine erfundenen Preise/Zeiten.' },
  { no: 37, layer: 'code', rule: 'Leere Suche: bis 3 Retries mit anderen Terms.' },
  { no: 40, layer: 'code', rule: 'API >5s → Fallback + User informieren.' },
  { no: 44, layer: 'code', rule: 'Alle Fremdpreise sofort in Euro.' },
  { no: 48, layer: 'code', agents: ['gastro'], rule: 'Places min_rating=3.5.' },
  { no: 53, layer: 'code', rule: 'Keine Buttons ohne ausführbaren Payload.' },
  { no: 59, layer: 'code', rule: 'Button max 3–4 Worte / 20 Zeichen.' },
  { no: 69, layer: 'code', agents: ['mobility'], rule: 'Vektor-Priorität aus Rucksack-GPS.' },
  { no: 95, layer: 'code', agents: ['emergency'], rule: 'Notfall-Bypass vor normaler Pipeline.' },
  { no: 180, layer: 'code', rule: 'Self-Check: 600-Zeichen-Chunk-Limit eingehalten.' },
  { no: 189, layer: 'code', rule: 'Offline-Grace: lokal kommunizieren, Cache nutzen.' },

  { no: 10, layer: 'agent', agents: ['gastro'], rule: 'Speisekarten zusammenfassen, nicht vorlesen.' },
  { no: 11, layer: 'agent', agents: ['knowledge'], rule: 'Lokales Phonetik-Wörterbuch nutzen.' },
  { no: 130, layer: 'agent', agents: ['gastro'], rule: 'Allergien/Vegan immer ungefragt filtern.' },
  { no: 161, layer: 'agent', agents: ['knowledge'], rule: 'Historical Layering — was vor 100 Jahren war.' },
  { no: 70, layer: 'agent', agents: ['mobility'], rule: 'Wo bin ich: in Blickrichtung antworten.' },

  { no: 56, layer: 'ui', rule: 'Mic Listening → alte Buttons/Bullets löschen.' },
  { no: 57, layer: 'ui', rule: 'Color States: grau/grün/orange/rot/blau/gelb.' },
  { no: 60, layer: 'ui', rule: 'HUD-Prio oben links: Timer → Nav → stumme Warnungen → Teaser.' },

  { no: 28, layer: 'background', rule: 'Supermarkt-Radar; Audio nur bei offenem Einkaufs-To-Do.' },
  { no: 31, layer: 'background', rule: 'Konflikt-Scanner bei Termin-Überlappung.' },
  { no: 92, layer: 'background', rule: 'Spatial Triggers via natives Geofencing.' },
];

export function lawsForLayer(layer: LawLayer): Module2Law[] {
  return MODULE2_LAYERED_LAWS.filter((l) => l.layer === layer);
}

export function agentPromptLaws(agent: string, max = 8): string {
  const list = MODULE2_LAYERED_LAWS.filter(
    (l) =>
      l.layer === 'agent' &&
      (!l.agents || l.agents.length === 0 || l.agents.includes(agent)),
  ).slice(0, max);
  if (list.length === 0) return '';
  return list.map((l) => `- (${l.no}) ${l.rule}`).join('\n');
}

export function formatCodeLawChecklist(): string {
  return lawsForLayer('code')
    .map((l) => `L${l.no}`)
    .join(',');
}
