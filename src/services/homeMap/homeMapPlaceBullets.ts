/**
 * Zwei Stichpunkte für Ort-Popup (offline aus Pack-Fakten).
 *
 * 1) Was ist dieser Ort? — Identität, kurz, max. ~2 UI-Zeilen.
 * 2) Warum hingehen? — Hook / was man vor Ort sieht oder tun kann.
 *
 * Keine Erkennungs-FAQ, keine Adresse, kein Generika-Jargon.
 * Länge hart begrenzt, damit `numberOfLines={2}` nicht mittendrin abschneidet.
 */

import { looksLikeAddressOrCoordBullet } from '../../utils/addressPrivacy';
import type { PoiWithFacts } from '../../db/types';
import { parkingCostHintFromPoi } from './homeMapMobilityAmenity';

const TAG_RE =
  /^\[(?:Erzählung|Detail|Teaser|Kurzfakt|FAQ|Hook|Narration|Thema:[^\]]+)\]\s*/i;
const FAQ_RE = /^User-Frage:\s*(.+?)\?\s*Antwort:\s*(.+)$/is;
const RECOGNIZE_RE =
  /woran erkenne ich|erkenne ich (?:diesen ort|den ort)|im ortsbild sofort|an beschilderung\/lage|an lage\/beschilderung|markante fassade\/form/i;
const GENERIC_JARGON_RE =
  /technisches denkmal der infrastruktur|kein besucherzentrum|orientierungswahrzeichen(?!.*wand)|mit eigener geschichte vor ort|zentrumsanker|transformationsgeschichte/i;
const QUIZ_RE = /schätzfrage:|quiz:|\(antwort:/i;
const GPS_RE = /gps-eingang|osm way|osm \w+ \d{5,}|sourced_osm|koordinaten\s*~/i;
const LIVE_HEAD_RE = /^live:\s/i;
const OPS_FILLER_RE =
  /^(?:aktuell\s+)?pädagogischer betrieb\b|keine öffentlichen toiletten|live öffnung|live zeiten prüfen/i;
const CHAT_FLUFF_RE =
  /^(?:ja|nein)[,!.]?\s|beliebter .+ moment|vom tresen zur tanz|ein ruhiger stopp lohnt|kann ich bei .+ sitzen|offline-directory|offline-katalog|ist ein \w+-punkt in/i;
const VAGUE_CAT_RE =
  /^(geschichte|aussicht|ort|sehensw[uü]rdigkeit|highlight|touristic|kultur)$/i;
const FAQ_TAG_RE = /\[(?:FAQ|Thema:(?:faq|user_question|quiz|cta))\]/i;

function stripAddressTelNoise(text: string): string {
  return text
    .replace(/\btel\.?\s*[\d\s\/-]{6,}/gi, ' ')
    .replace(
      /\b[\wÄÖÜäöüß.-]+(?:straße|strasse|str\.|allee)\s+\d{1,4}[a-zA-Z]?\b/gi,
      ' ',
    )
    .replace(/\b\d{5}\s+[A-ZÄÖÜa-zäöü][\wÄÖÜäöüß-]*/gi, ' ')
    .replace(/\s*[—,;|/]+\s*/g, ' — ')
    .replace(/\s+/g, ' ')
    .replace(/^[—\s]+|[—\s]+$/g, '')
    .trim();
}

function isHardGeoDump(text: string): boolean {
  if (/\bgps\b|\blat\b|\blng\b|koordinate/i.test(text)) return true;
  const rest = stripAddressTelNoise(text);
  // Nur Adresse/Tel übrig → Müll
  if (rest.length < 18) return true;
  if (looksLikeAddressOrCoordBullet(text) && STREET_DOMINATED_RE.test(text) && rest.length < 28) {
    return true;
  }
  return false;
}
const STREET_DOMINATED_RE =
  /(?:haupt|schul|bahnhof|dorf|kirchen|markt|linden|post|hudenbarg)(?:straße|strasse)|ecke\s+\w+(?:straße|strasse)|am gebäude\s+\w+(?:straße|strasse)/i;

const WHAT_RE =
  /\b(ist ein|ist eine|war ein|war eine|ehemalige|früher|gegründet|umbau|seit \d{4}|kindergarten|kita|schule|volksschule|unterführung|museum|kirche|park|garten|denkmal|ehrendenkmal|krieger|café|cafe|bahnhof|haltepunkt|feuerwehr|gasthof|hotel|restaurant|bistro|brücke|parkplatz|p\+r|sport|verein|apotheke|praxis)\b/i;
const WHY_RE =
  /\b(wandmalerei|graffiti|street.?art|spielplatz|anschauen|fotografieren|highlight|lohnt|schau |sieh |erleben|entdecken|mitmachen|besonders|einzig|spannend|sehenswert|heute|jetzt|hofbaum|jubiläum|verewigt|küche|frühstück|übernacht|fremdenzimmer|mediterran|pendler|park(?:en|platz)|zug nehmen|tsv|tanz)\b/i;

/** ~2 UI-Zeilen bei fontSize 14 / ~300px Kartenbreite (inkl. „· “). */
const WHAT_MAX = 72;
const WHY_MAX = 72;

type Candidate = {
  text: string;
  fromFaq: boolean;
  fromKurz: boolean;
  fromStory: boolean;
  fromCta: boolean;
};

function humanizeFact(text: string): string {
  return text
    .replace(/^transformationsgeschichte\s*/i, '')
    .replace(/^zentrumsanker\b[^.!]*[.!]?/i, '')
    .replace(/\bschule\s*→\s*kita\b/i, 'früher Dorfschule, heute Kindergarten')
    .replace(/^heute:\s*/i, '')
    .replace(/\s+zwischen hamburg und nordsee\.?$/i, '')
    .replace(/\s*[—–-]\s*und denk daran:[^.!]*[.!]?/i, '')
    .replace(/\s*und denk daran:[^.!]*[.!]?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTag(raw: string): string {
  return raw.replace(TAG_RE, '').replace(/^➔\s*/u, '').replace(/\s+/g, ' ').trim();
}

function unwrapFaq(raw: string): { question: string | null; text: string } {
  const t = stripTag(raw);
  const m = t.match(FAQ_RE);
  if (m) return { question: m[1]!.trim(), text: m[2]!.trim() };
  const vis = t.match(/^Woran erkenne ich .+?\?\s*(.+)$/is);
  if (vis) return { question: 'Woran erkenne ich diesen Ort', text: vis[1]!.trim() };
  return { question: null, text: t };
}

/** Adress-/Lage-Vorspann weg, Identität behalten. */
function stripLocationLead(text: string): string {
  return text
    .replace(
      /^(?:am gebäude\s+)?[\wÄÖÜäöüß.\/\-]+(?:straße|strasse)(?:\s*\/\s*[\wÄÖÜäöüß.\/\-]+(?:straße|strasse))?(?:\s+ecke\s+[\wÄÖÜäöüß.\-]+(?:straße|strasse)?)?\s*[:—–-]\s*/i,
      '',
    )
    .replace(/^an (?:der|dem)\s+[\wÄÖÜäöüß.\-]+(?:straße|strasse)\s*[:—–-]\s*/i, '')
    .replace(
      /^[\wÄÖÜäöüß.\/\-]+(?:straße|strasse)\s+\d{1,4}[a-zA-Z]?\s*[:—–-]\s*/i,
      '',
    )
    // "Hoyers Gasthof Hauptstraße 102: …" / "… 102 — …"
    .replace(
      /^[\wÄÖÜäöüß.'’\- ]{2,40}?\b[\wÄÖÜäöüß.-]+(?:straße|strasse)\s+\d{1,4}[a-zA-Z]?\s*[:—–-]\s*/i,
      '',
    )
    .replace(
      /^[\wÄÖÜäöüß.'’\- ]{2,40}?\b[\wÄÖÜäöüß.-]+(?:straße|strasse)\s+\d{1,4}[a-zA-Z]?\s*[—,;]\s*/i,
      '',
    )
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.replace(/^[—–-]\s*/, '').trim())
    .filter((s) => s.length >= 12);
}

function compactLine(text: string, max: number): string {
  let t = text
    .replace(/\s+/g, ' ')
    .replace(/^[—–•·]+\s*/, '')
    .replace(/\s*\([^)]{12,}\)/g, '')
    .replace(
      /\s*(?:lokales infrastruktur-kunstprojekt|kein street-art-viertel[^.]*|oft interessanter als[^.]*|kein besucherzentrum|und denk daran:|das ist der visuelle aufhänger|oft übersehen)\s*/gi,
      ' ',
    )
    .replace(/\s*—\s*,/g, ' — ')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/u, '')
    .replace(/—\s+(Hier|Da|Dort)\b/g, (_m, w: string) => ` — ${String(w).toLowerCase()}`)
    .replace(/[.,;:\s]+$/u, '')
    .trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const at = Math.max(
    slice.lastIndexOf(' — '),
    slice.lastIndexOf('. '),
    slice.lastIndexOf(', '),
  );
  const cut = (at >= 28 ? slice.slice(0, at) : slice.replace(/\s+\S*$/, ''))
    .replace(/[,;:]$/, '');
  return cut
    .replace(/[—–-]\s*$/u, '')
    .replace(/[.,;:\s]+$/u, '')
    .replace(/\s+\b(und|oder|der|die|das|den|dem|ein|eine|mit|zum|zur|vom|von)\s*$/i, '')
    .trim();
}

function isNoise(question: string | null, text: string): boolean {
  const blob = `${question ?? ''} ${text}`;
  if (RECOGNIZE_RE.test(blob)) return true;
  if (QUIZ_RE.test(text)) return true;
  if (GPS_RE.test(text)) return true;
  if (LIVE_HEAD_RE.test(text)) return true;
  if (OPS_FILLER_RE.test(text) && text.length < 100) return true;
  if (GENERIC_JARGON_RE.test(text)) return true;
  if (CHAT_FLUFF_RE.test(text)) return true;
  if (isHardGeoDump(text)) return true;
  const stripped = stripLocationLead(text);
  if (stripped.length < 18 && STREET_DOMINATED_RE.test(text)) return true;
  if (/^zentrumsanker\b/i.test(text)) return true;
  return false;
}

function scoreWhat(c: Candidate): number {
  const text = c.text;
  let s = 0;
  if (WHAT_RE.test(text)) s += 4;
  if (/\b(1[89]\d{2}|20\d{2})\b/.test(text)) s += 3;
  if (/\b(ehemalige|früher|umbau|nachfolger|gegründet|quert)\b/i.test(text)) s += 2;
  if (/\b(dorfschule|volksschule).*(kindergarten|kita)|\bfrüher\b.*\bheute\b/i.test(text)) {
    s += 3;
  }
  if (/\b(gasthof|hotel|restaurant|mediterran|küche)\b/i.test(text)) s += 2;
  if (text.length >= 24 && text.length <= 90) s += 3;
  if (text.length > 110) s -= 3;
  if (c.fromKurz || c.fromStory) s += 3;
  if (c.fromFaq) s -= 8;
  if (c.fromCta) s -= 2;
  if (/\b(wandmalerei|fotografieren|highlight|schau )\b/i.test(text)) s -= 3;
  if (WHY_RE.test(text) && !WHAT_RE.test(text)) s -= 1;
  if (STREET_DOMINATED_RE.test(text) && !/\b(seit|gegründet|umbau|volksschule)\b/i.test(text)) {
    s -= 6;
  }
  if (/\b(gmbh|mio\.?\s*euro|lichtraumhöhe)\b/i.test(text)) s -= 2;
  return s;
}

function scoreWhy(c: Candidate): number {
  const text = c.text;
  let s = 0;
  if (WHY_RE.test(text)) s += 5;
  if (/\b(wandmalerei|street.?art|anschauen|fotografieren|highlight)\b/i.test(text)) {
    s += 4;
  }
  if (/\b(schau |sieh |vom weg|vor ort|hofbaum)\b/i.test(text)) s += 3;
  if (/\b(küche|frühstück|fremdenzimmer|mediterran|übernacht)\b/i.test(text)) s += 3;
  if (/\b(tsv|1947|tanz)\b/i.test(text)) s += 2;
  if (text.length >= 20 && text.length <= 90) s += 3;
  if (text.length > 110) s -= 3;
  if (c.fromCta) s += 4;
  if (c.fromKurz) s += 1;
  if (c.fromFaq) s -= 8;
  if (WHAT_RE.test(text) && !WHY_RE.test(text)) s -= 1;
  if (/\b(gmbh|mio\.?\s*euro)\b/i.test(text)) s -= 3;
  if (STREET_DOMINATED_RE.test(text)) s -= 4;
  return s;
}

function sameHook(a: string, b: string): boolean {
  const key = (t: string) =>
    (
      t.toLowerCase().match(
        /wandmalerei|hofbaum|volksschule|kindergarten|brücke|krieger|ehrenmal/g,
      ) || []
    ).join('|');
  const ka = key(a);
  const kb = key(b);
  return Boolean(ka) && ka === kb;
}

function candidatesFromPoi(poi: PoiWithFacts | null | undefined): Candidate[] {
  const raw = [
    poi?.teaser_text ?? '',
    ...(poi?.facts ?? []).map((f) => f.fact_text ?? ''),
  ];
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (
    text: string,
    meta: Omit<Candidate, 'text'>,
  ) => {
    const t = humanizeFact(text.trim());
    if (t.length < 12 || t.length > 220) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: t, ...meta });
  };

  for (const item of raw) {
    const rawItem = String(item || '');
    const fromFaq =
      FAQ_TAG_RE.test(rawItem) ||
      /User-Frage:/i.test(rawItem) ||
      /^Woran erkenne ich /i.test(stripTag(rawItem));
    const fromKurz = /\[Kurzfakt\]/i.test(rawItem);
    const fromStory = /\[Erzählung\]/i.test(rawItem);
    const fromCta = /\[Thema:cta\]/i.test(rawItem);
    const meta = { fromFaq, fromKurz, fromStory, fromCta };

    const { question, text: rawText } = unwrapFaq(rawItem);
    const text = humanizeFact(stripLocationLead(rawText));
    if (!text || isNoise(question, text)) continue;
    // FAQ-Antworten nur behalten, wenn klar sachlich (kein Plauder-Ton)
    if (fromFaq && (CHAT_FLUFF_RE.test(text) || text.length > 120)) continue;

    const bits = text.length > 78 ? splitSentences(text) : [];
    if (bits.length >= 2) {
      for (const s of bits) {
        const part = humanizeFact(stripLocationLead(s));
        if (part && !isNoise(question, part)) push(part, meta);
      }
    } else {
      push(text, meta);
    }
  }
  return out;
}

/**
 * Liefert genau bis zu 2 Stichpunkte:
 * [0] kurze Zusammenfassung „was ist das“
 * [1] Motiv „warum hingehen“
 */
export function buildHomeMapPlaceBullets(
  poi: PoiWithFacts | null | undefined,
  _categoryHint?: string | null,
): string[] {
  const pool = candidatesFromPoi(poi);

  let whatCand =
    [...pool].sort((a, b) => scoreWhat(b) - scoreWhat(a)).find((t) => scoreWhat(t) > 0) ??
    pool.find((c) => !c.fromFaq) ??
    null;
  let whyCand =
    [...pool]
      .sort((a, b) => scoreWhy(b) - scoreWhy(a))
      .find(
        (t) =>
          t.text !== whatCand?.text &&
          scoreWhy(t) > 0 &&
          (!whatCand || !sameHook(t.text, whatCand.text)),
      ) ??
    [...pool]
      .sort((a, b) => scoreWhy(b) - scoreWhy(a))
      .find((t) => t.text !== whatCand?.text && scoreWhy(t) > 0) ??
    null;

  let what = whatCand?.text ?? null;
  let why = whyCand?.text ?? null;

  if (
    what &&
    why &&
    ((/^(schau|sieh)\b/i.test(what) &&
      /\b(1[89]\d{2}|20\d{2}|ehemalige|gegründet|umbau)\b/i.test(why)) ||
      (/\bwandmalerei\b/i.test(what) && /brücke|gegründet|volksschule|quert/i.test(why)))
  ) {
    const swapped = what;
    what = why;
    why = swapped;
  }

  const out: string[] = [];
  if (what) out.push(compactLine(what, WHAT_MAX));
  if (why) out.push(compactLine(why, WHY_MAX));

  const clean = out.filter(
    (t) =>
      t.length >= 12 &&
      t.length <= Math.max(WHAT_MAX, WHY_MAX) + 2 &&
      !isNoise(null, t) &&
      !isHardGeoDump(t) &&
      !GENERIC_JARGON_RE.test(t) &&
      !CHAT_FLUFF_RE.test(t) &&
      !/^mit eigener geschichte/i.test(t),
  );
  // Dedup ähnliche Zeilen
  const uniq: string[] = [];
  for (const t of clean) {
    if (uniq.some((u) => sameHook(u, t) && Math.abs(u.length - t.length) < 20)) {
      continue;
    }
    if (uniq.some((u) => u.toLowerCase() === t.toLowerCase())) continue;
    uniq.push(t);
  }
  if (uniq.length >= 2) return uniq.slice(0, 2);
  if (uniq.length === 1) {
    const parkHint = poi ? parkingCostHintFromPoi(poi) : null;
    if (parkHint && !uniq[0]!.toLowerCase().includes('kostenlos')) {
      return [uniq[0]!, compactLine(parkHint, WHY_MAX)];
    }
    return uniq;
  }
  const parkHint = poi ? parkingCostHintFromPoi(poi) : null;
  if (parkHint) return [compactLine(parkHint, WHAT_MAX)];
  return [];
}

export function categoryLabelForPoi(poi: {
  category?: string | null;
  name?: string | null;
  tags_json?: string | null;
}): string {
  const name = (poi.name ?? '').trim();
  const fromName = categoryFromName(`${name} ${poi.tags_json ?? ''}`);
  if (fromName) return fromName;
  const c = (poi.category ?? '').trim();
  if (c && !VAGUE_CAT_RE.test(c)) {
    return c.charAt(0).toUpperCase() + c.slice(1);
  }
  const blob = `${name} ${poi.tags_json ?? ''}`.toLowerCase();
  if (/museum/.test(blob)) return 'Museum';
  if (/kirche|dom|kapelle/.test(blob)) return 'Kirche';
  if (/café|cafe|kaffee/.test(blob)) return 'Café';
  if (/restaurant|imbiss|bistro|gasthof/.test(blob)) return 'Restaurant';
  if (/park|garten/.test(blob)) return 'Park';
  if (/hotel|hostel/.test(blob)) return 'Hotel';
  if (/briefkasten|post_box|mailbox/.test(blob)) return 'Briefkasten';
  if (/packstation|parcel_locker|paketautomat/.test(blob)) return 'Packstation';
  if (/bahnhof|haltepunkt|haltestelle|bus/.test(blob)) return 'ÖPNV';
  if (/praxis|arzt|zahn|gesundheit/.test(blob)) return 'Gesundheit';
  if (/feuerwehr/.test(blob)) return 'Feuerwehr';
  if (/kindergarten|kita/.test(blob)) return 'Kita';
  if (/denkmal|ehrendenkmal|krieger/.test(blob)) return 'Denkmal';
  if (/parkplatz|p\+r|parking/.test(blob)) return 'Parkplatz';
  if (/freizeit|sport|minigolf/.test(blob)) return 'Freizeit';
  return 'Ort';
}

function categoryFromName(blob: string): string | null {
  const t = blob.toLowerCase();
  // Berufe/Orte vor Straßen-/Viertel-Tags wie „bahnhof“ in tags_json
  if (/kindergarten|kita|krippe/.test(t)) return 'Kita';
  if (/zahnarzt|zahnärztin|zahnaerztin|\barztpraxis\b|\barzt\b|ärztin|aerztin|praxis/.test(t)) {
    return 'Gesundheit';
  }
  if (/brücke|bruecke|unterführung/.test(t)) return 'Brücke';
  if (/kirche|kapelle|\bdom\b/.test(t)) return 'Kirche';
  if (/museum/.test(t)) return 'Museum';
  // Nur echter Halt im Namen — nicht „Bahnhofstraße“ / District-Tag „bahnhof“
  if (/\b(bahnhof|haltepunkt|hbf)\b/.test(t) && !/straße|strasse|str\./.test(t)) {
    return 'Bahnhof';
  }
  if (/feuerwehr/.test(t)) return 'Feuerwehr';
  if (/krieger|ehrenmal|denkmal/.test(t)) return 'Denkmal';
  if (/gasthof|restaurant/.test(t)) return 'Restaurant';
  return null;
}
