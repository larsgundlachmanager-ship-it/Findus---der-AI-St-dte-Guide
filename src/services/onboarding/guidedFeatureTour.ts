/**
 * Geführte Feature-Tour nach Setup — SSOT für Sprache + Demo-Hints.
 * First-download Erklärung ≠ normale App-Starts (Welcome-Back / City-Return).
 */

import { budgetSpeechFromProfile } from '../../constants/budgetHints';
import { EXPERIENCE_CARDS } from '../../constants/onboardingOptions';
import { CORE_ROLES, VIBE_TONES } from '../../constants/personalityMatrix';
import type { ExplanationHint, ExplanationSegment } from '../../i18n';
import type { UserProfile } from '../../types/userProfile';
import {
  getCachedWeatherSnapshot,
  getCachedWeatherSummary,
  type WeatherSnapshot,
} from '../weatherService';
import { splitTextToStreamingChunks } from '../audio/punctuationChunker';
import { estimateSpeechDurationMs } from '../../utils/subtitleWholeWords';

export type GuidedTourSegment = ExplanationSegment & {
  demoTitle?: string;
  /** Landmarke für Modul-1-Demo */
  landmarkName?: string;
};

function clampTour(text: string, max = 420): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  const stop = Math.max(
    cut.lastIndexOf('.'),
    cut.lastIndexOf('!'),
    cut.lastIndexOf('?'),
  );
  if (stop > max * 0.45) cut = cut.slice(0, stop + 1);
  return cut.trim();
}

function clampChars(text: string, min: number, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max && t.length >= min) return t;
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  const stop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf(','));
  if (stop > min) cut = cut.slice(0, stop + 1);
  return cut.trim();
}

/** Nach der App-Erklärung: kurz selbst ankommen, dann Stadt-Welcome. */
export const POST_EXPLANATION_SETTLE_MS = 2_000;

/** Regionale Begrüßung nach Stadt / Region — einheimisch, nicht 0815. */
export function regionalGreeting(cityName: string | null | undefined): string {
  const c = (cityName ?? '').toLowerCase();
  if (
    /london|manchester|liverpool|edinburgh|oxford|cambridge|bristol|glasgow|dublin|birmingham|leeds/.test(
      c,
    )
  ) {
    return 'Hello';
  }
  if (
    /paris|lyon|marseille|nice|bordeaux|toulouse|lille|strasbourg|nantes/.test(c)
  ) {
    return 'Bonjour';
  }
  if (
    /roma|rom\b|milan|milano|firenze|florenz|venezia|venedig|napoli|neapel|torino/.test(
      c,
    )
  ) {
    return 'Ciao';
  }
  if (/madrid|barcelona|sevilla|valencia|lisboa|lisbon|porto/.test(c)) {
    return 'Hola';
  }
  if (/amsterdam|rotterdam|utrecht|den haag|haarlem/.test(c)) {
    return 'Hoi';
  }
  if (/zürich|zurich|bern|genf|geneva|basel|luzern/.test(c)) {
    return 'Grüezi';
  }
  if (
    /kopenhagen|copenhagen|stockholm|oslo|göteborg|goteborg|helsinki/.test(c)
  ) {
    return 'Hej';
  }
  if (
    /hamburg|prisdorf|pinneberg|schleswig|kiel|lübeck|lubeck|bremen|niedersachsen|emden|flensburg|rostock|wismar|stralsund|sylt|wangerooge|norderney|helgoland|cuxhaven|oldenburg|hannover/.test(
      c,
    )
  ) {
    return 'Moin';
  }
  if (
    /münchen|munchen|bayern|nürnberg|nurnberg|augsburg|regensburg|passau|stuttgart|baden|freiburg|ulm|konstanz|salzburg|innsbruck|wien|graz/.test(
      c,
    )
  ) {
    return 'Servus';
  }
  return 'Hallo';
}

export type CityDemoPack = {
  landmark: string;
  intro: string;
  highlights: string;
  timelineStops: [string, string, string];
  /** Kurzer Aktivitäts-Teaser bei gutem Wetter (in den Fließtext eingewebt). */
  fairWeatherTeaser: string;
};

/** Berühmtes Ensemble + Kurz-Intro + Timeline-Beispiele je Stadt. */
export function cityDemoPack(cityName: string | null | undefined): CityDemoPack {
  const c = (cityName ?? '').toLowerCase();
  if (/hamburg/.test(c)) {
    return {
      landmark: 'Elbphilharmonie',
      intro:
        'Hamburg atmet Hafen, Speicherstadt und Elbe — eine Stadt, die sich zwischen Wasser und Backstein ständig neu erfindet.',
      highlights:
        'Wenn du magst, steuern wir die Elbphilharmonie an, tauchen in die Speicherstadt und lassen die Landungsbrücken auf dich wirken.',
      timelineStops: ['Elbphilharmonie', 'Speicherstadt', 'Landungsbrücken'],
      fairWeatherTeaser: 'eine Runde am Hafen oder hoch zur Plaza',
    };
  }
  if (/berlin/.test(c)) {
    return {
      landmark: 'Brandenburger Tor',
      intro:
        'Berlin ist Geschichte und Gegenwart auf engstem Raum — Kieze, Museen, große Plätze, die plötzlich ganz still werden können.',
      highlights:
        'Klassiker wie das Brandenburger Tor, die Museumsinsel und ein Spaziergang am Spreeufer lohnen sich immer.',
      timelineStops: ['Brandenburger Tor', 'Museumsinsel', 'East Side Gallery'],
      fairWeatherTeaser: 'ein Spaziergang am Spreeufer oder Kaffee draußen',
    };
  }
  if (/münchen|munchen/.test(c)) {
    return {
      landmark: 'Marienplatz',
      intro:
        'München mischt Traditionsbiergarten und Großstadt — Altstadt, Parks und manchmal sogar Alpenblick.',
      highlights:
        'Marienplatz, Englischer Garten und die Pinakotheken sind starke Anker, wenn du die Stadt spüren willst.',
      timelineStops: ['Marienplatz', 'Englischer Garten', 'Deutsches Museum'],
      fairWeatherTeaser: 'eine Schlaufe durch den Englischen Garten',
    };
  }
  if (/prisdorf/.test(c)) {
    return {
      landmark: 'Gemeindezentrum am Hudenbarg',
      intro:
        'Prisdorf ist gemütliches Schleswig-Holstein: Marsch, Dorfkern und die Bahn nach Hamburg in greifbarer Nähe — kein Touristen-Zirkus, eher ein Ort zum Ankommen.',
      highlights:
        'Am Hudenbarg schlägt das Herz mit Gemeindezentrum, Feuerwehr und Kindergarten; vom Bahnhof bist du schnell in der Stadt, oder du bleibst einfach im Grünen.',
      timelineStops: [
        'Gemeindezentrum am Hudenbarg',
        'Bahnhof Prisdorf',
        'Abendlicht am Feldrand',
      ],
      fairWeatherTeaser: 'eine lockere Runde durchs Dorf oder raus an den Feldrand',
    };
  }
  if (/pinneberg/.test(c)) {
    return {
      landmark: 'Drostei',
      intro:
        'Pinneberg mischt Kleinstadt-Ruhe mit schneller Anbindung nach Hamburg — und die Drostei sitzt mittendrin wie ein ruhiger Anker.',
      highlights:
        'Schau dir die Drostei an, gönn dir den Stadtpark und lass die Fußgängerzone auf dich wirken.',
      timelineStops: ['Drostei', 'Stadtpark', 'Fußgängerzone'],
      fairWeatherTeaser: 'Café vor der Drostei oder eine Runde Stadtpark',
    };
  }
  if (/köln|koln/.test(c)) {
    return {
      landmark: 'Kölner Dom',
      intro:
        'Köln lebt vom Dom, dem Rhein und einer lockeren, offenen Stimmung, die dich schnell mitnimmt.',
      highlights:
        'Dom, Rheinboulevard und die Altstadt um den Heumarkt — das sind die Klassiker, die sitzen.',
      timelineStops: ['Kölner Dom', 'Rheinboulevard', 'Alter Markt'],
      fairWeatherTeaser: 'Rheinboulevard oder ein Bummel durch die Altstadt',
    };
  }
  if (/london/.test(c)) {
    return {
      landmark: 'Tower Bridge',
      intro:
        'London ist Schichten aus Geschichte und Großstadt-Rhythmus — Themse, Parks und Wahrzeichen, die man am besten zu Fuß spürt.',
      highlights:
        'Tower Bridge, Westminster und ein Bummel am Fluss geben dir schnell ein Gefühl für die Stadt.',
      timelineStops: ['Tower Bridge', 'Westminster', 'South Bank'],
      fairWeatherTeaser: 'eine Runde entlang der Themse',
    };
  }
  const city = (cityName ?? '').trim() || 'deiner Stadt';
  return {
    landmark: `Wahrzeichen von ${city}`,
    intro: clampChars(
      `${city} steckt voller Ecken, die man am besten zu Fuß entdeckt — Geschichte, Plätze und lokale Treffpunkte.`,
      150,
      220,
    ),
    highlights:
      'Lass uns das berühmteste Ensemble ansteuern, den zentralen Platz und einen lokalen Lieblingsort.',
    timelineStops: [
      `Zentrum ${city}`,
      'Lokales Highlight',
      'Sonnenuntergang',
    ],
    fairWeatherTeaser: 'eine kurze Runde draußen, solange es so bleibt',
  };
}

function prefLabel(id: string): string {
  const hit = EXPERIENCE_CARDS.find((c) => c.id === id);
  if (hit?.labelDe) return hit.labelDe.replace(/\s*&\s*.*$/, '').trim();
  return id.replace(/_/g, ' ');
}

/** Interessen als natürliche Phrase — Prefs + Freitext, keine ID-Liste. */
function interestPhrase(profile: UserProfile): string {
  const likes: string[] = [];
  for (const [k, v] of Object.entries(profile.experiencePrefs ?? {})) {
    if (v === 'yes') likes.push(prefLabel(k));
  }
  const want = (profile.wantToExperience ?? '').trim().replace(/\s+/g, ' ');
  if (likes.length === 0) {
    return want.length <= 120 ? want : want.slice(0, 117).replace(/\s+\S*$/, '');
  }
  const top = likes.slice(0, 5);
  let prefs = '';
  if (top.length === 1) prefs = top[0]!;
  else if (top.length === 2) prefs = `${top[0]} und ${top[1]}`;
  else if (top.length === 3) {
    prefs = `${top[0]}, ${top[1]} und ${top[2]}`;
  } else {
    prefs = `${top.slice(0, -1).join(', ')} und ${top[top.length - 1]}`;
  }
  if (!want || want.length > 100) return prefs;
  if (want.toLowerCase().includes(prefs.toLowerCase().slice(0, 12))) {
    return want.length <= 140
      ? want
      : `${want.slice(0, 137).replace(/\s+\S*$/, '')}…`;
  }
  return `${prefs} — und du willst ${want.length <= 70 ? want : `${want.slice(0, 67)}…`}`;
}

function roleVibeBit(profile: UserProfile): string {
  const role = CORE_ROLES.find((r) => r.id === profile.coreRole);
  const vibe = VIBE_TONES.find((v) => v.id === profile.vibeTone);
  if (role && vibe) {
    return `als ${role.labelDe}, eher ${vibe.labelDe.toLowerCase()}`;
  }
  if (role) return `im ${role.labelDe}-Modus`;
  const chars = (profile.characters ?? []).filter(Boolean);
  if (chars.some((c) => /genz|party|aufgedreht/i.test(c))) {
    return 'eher locker und mit Drive';
  }
  if (chars.some((c) => /historiker|erzaehler|ruhig/i.test(c))) {
    return 'gerne mit Story und Ruhe';
  }
  return '';
}

function foodCareBit(profile: UserProfile): string {
  const diet = (profile.dietaryTags ?? [])
    .filter((t) => t && t !== 'keine')
    .slice(0, 2);
  const allergy = [
    ...(profile.allergyTags ?? []).filter((t) => t && t !== 'keine'),
    (profile.allergies ?? '').toString().trim(),
  ]
    .filter(Boolean)
    .slice(0, 2);
  if (allergy.length) {
    return `Beim Essen passe ich auf ${allergy.join(' und ')} auf`;
  }
  if (diet.length) {
    return `Beim Essen habe ich ${diet.join(' und ')} im Blick`;
  }
  return '';
}

/**
 * Interessen-Zusammenfassung — fließend, erlebnisorientiert (sehen/erleben).
 */
function paraphraseProfile(profile: UserProfile): string {
  const name = profile.firstName.trim() || 'du';
  const vibe = roleVibeBit(profile);
  const interests = interestPhrase(profile);
  const avoid = (profile.avoidExperience ?? '').trim();
  const food = foodCareBit(profile);
  const about = (profile.aboutMe ?? '').trim();

  const parts: string[] = [];
  if (vibe && interests) {
    parts.push(
      `${name}, ich nehme dich ${vibe} mit — du willst vor allem ${interests} sehen und spüren.`,
    );
  } else if (interests) {
    parts.push(`${name}, bei dir geht’s klar ums Erleben: ${interests}.`);
  } else if (vibe) {
    parts.push(
      `${name}, ich begleite dich ${vibe} und wir finden Orte, die dazu passen.`,
    );
  } else {
    parts.push(
      `${name}, dein Profil sitzt — wir drehen den Fokus auf das, was du hier erleben willst.`,
    );
  }

  if (avoid && avoid.length <= 70) {
    parts.push(`${avoid} lassen wir links liegen.`);
  } else if (avoid) {
    parts.push('Das Meiden-Zeug bleibt draußen.');
  }

  if (food) parts.push(`${food}.`);

  if (profile.budgetCategory) {
    parts.push(`Beim Budget bleibe ich bei ${budgetSpeechFromProfile(profile)}.`);
  }

  if (about.length > 12) {
    parts.push('Passt zu dem, was du über dich erzählt hast.');
  }

  return clampTour(parts.join(' '), 360);
}

function stayWindowHint(profile: UserProfile): 'today' | 'weekend' | 'few_days' {
  const blob = [
    profile.wantToExperience,
    profile.avoidExperience,
    profile.travelPeriod ?? '',
    ...(profile.socialDynamics ?? []),
  ]
    .join(' ')
    .toLowerCase();
  if (/heute|nur heute|tagestour|ein tag/.test(blob)) return 'today';
  if (/wochenende|kurztrip|wochenend/.test(blob)) return 'weekend';
  return 'few_days';
}

function parseTempC(summary: string | null | undefined): number | null {
  const m = (summary ?? '').match(/(\d{1,2})\s*(?:°|Grad)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isFairWeather(snap: WeatherSnapshot | null, summary: string | null): boolean {
  if (snap?.isHeavyRain) return false;
  if ((snap?.nextRainProb ?? 0) >= 45) return false;
  if ((snap?.precipitationMm ?? 0) > 0.5) return false;
  const line = (summary ?? snap?.summaryLine ?? '').toLowerCase();
  if (/starkregen|regnet\s+stark|gewitter|sturm/.test(line)) return false;
  if (
    /regen/.test(line) &&
    !/trocken bis|kein regen|kein sicheres trocken|schauer möglich/i.test(line)
  ) {
    return false;
  }
  if (/schauer möglich|kein sicheres trocken/.test(line)) return false;
  return true;
}

/**
 * Wetter → Explore-Vibe (ohne Outfit/Kleidungs-Tipps — First-Launch).
 */
function weatherExploreFollowUp(
  snap: WeatherSnapshot | null,
  summary: string | null,
  teaser: string,
): string {
  const temp =
    snap?.currentTempC != null && Number.isFinite(snap.currentTempC)
      ? Math.round(snap.currentTempC)
      : parseTempC(summary ?? snap?.summaryLine);
  const fair = isFairWeather(snap, summary);

  if (!fair) {
    if (snap?.isHeavyRain || /starkregen|regnet\s+stark/.test(summary ?? '')) {
      return 'Draußen ist’s nass — Indoor-Ideen und kurze Indoor-Stops behalte ich im Blick.';
    }
    return 'Die Luft kann umschlagen — wir bleiben flexibel und finden trotzdem gute Ecken.';
  }

  if (temp != null && temp >= 24) {
    return `Mit rund ${temp} Grad ist draußen klar Erkunden-Wetter — ${teaser} passt super.`;
  }
  if (temp != null && temp >= 18) {
    return `Bei etwa ${temp} Grad lädt’s zum Flanieren ein — ${teaser}, wenn du magst.`;
  }
  if (temp != null && temp <= 8) {
    return `Es ist frisch (so um ${temp} Grad) — kurze Runden draußen gehen trotzdem, ${teaser}.`;
  }
  if (temp != null) {
    return `So um ${temp} Grad: gutes Tempo zum Entdecken — ${teaser}, solange es so bleibt.`;
  }
  return `Gutes Erkunden-Wetter — ${teaser}, solange es so bleibt.`;
}

function weatherSpeech(
  city: string,
  stay: 'today' | 'weekend' | 'few_days',
  summary: string | null,
  snap: WeatherSnapshot | null,
  teaser: string,
): string {
  void stay;
  const base =
    summary?.trim() ||
    snap?.summaryLine?.trim() ||
    `In ${city} hab ich gerade keinen frischen Wetter-Check.`;
  const follow = weatherExploreFollowUp(snap, summary, teaser);
  // Kein „Zum Wetter: …“-Meta — einfach flüssig daneben sagen
  return clampTour(`${base} ${follow}`, 360);
}

function niceTimeOfDay(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'schönen Morgen';
  if (h >= 11 && h < 14) return 'schönen Mittag';
  if (h >= 14 && h < 18) return 'schönen Nachmittag';
  if (h >= 18 && h < 22) return 'schönen Abend';
  return 'schöne Nacht';
}

export type BuildTourOpts = {
  profile: UserProfile;
  weatherSummary?: string | null;
  weatherSnapshot?: WeatherSnapshot | null;
};

/**
 * First-download Erklärung: lokale Begrüßung → knackige Stadt-Vorstellung →
 * App-Tour auf der echten Karte. Kein Pref-Rückblick, kein Wetter, kein „Jo“.
 * Danach kurze Pause + Stadt-Welcome (cityWelcomeService).
 */
export function buildGuidedFeatureTourSegments(
  opts: BuildTourOpts | { cityName: string },
): GuidedTourSegment[] {
  // Back-compat: alter Aufruf { cityName }
  if (!('profile' in opts)) {
    const pack = cityDemoPack(opts.cityName);
    return buildGuidedFeatureTourSegments({
      profile: {
        firstName: '',
        cityName: opts.cityName,
        characters: [],
        experiencePrefs: {},
        wantToExperience: '',
        avoidExperience: '',
      } as unknown as UserProfile,
    }).map((s) =>
      s.landmarkName ? s : { ...s, landmarkName: pack.landmark },
    );
  }

  const profile = opts.profile;
  const city = (profile.cityName ?? profile.cityId ?? 'deiner Stadt').trim();
  const name = profile.firstName.trim() || 'du';
  const greet = regionalGreeting(city);
  const pack = cityDemoPack(city);

  return [
    {
      hint: 'none',
      text: clampTour(`${greet} ${name} — willkommen in ${city}.`, 90),
    },
    {
      hint: 'none',
      text: clampTour(pack.intro, 160),
    },
    {
      hint: 'none',
      text: clampTour(
        'Bevor wir richtig reinstarten, zeig ich dir die App kurz.',
        90,
      ),
    },
    {
      hint: 'passport',
      demoTitle: 'Karte & Orte',
      landmarkName: pack.landmark,
      text: clampTour(
        `Karte und Mikro sind zentral. Auf der Karte siehst du, wo du bist, und die Orte um dich: Grün schon gesehen, lila interessant, blau geplant. Unten bei Orte kannst du Kategorien wählen, suchen und Vorschläge anschauen.`,
        280,
      ),
    },
    {
      hint: 'actions',
      demoTitle: 'Ort öffnen',
      landmarkName: pack.landmark,
      text: clampTour(
        'Tipp auf einen Ort — dann startest du die Navigation, oder öffnest die Website wenn eine da ist.',
        140,
      ),
    },
    {
      hint: 'timeline',
      demoTitle: 'Timeline',
      text: clampTour(
        `Unten links die Timeline: was ansteht — zum Beispiel ${pack.timelineStops[0]}, ${pack.timelineStops[1]}, ${pack.timelineStops[2]}.`,
        220,
      ),
    },
    {
      hint: 'settings',
      demoTitle: 'Einstellungen',
      text: clampTour(
        'Einstellungen findest du unten rechts.',
        80,
      ),
    },
    {
      hint: 'settings_panel',
      demoTitle: 'Einstellungen offen',
      text: clampTour(
        'Hier wechselst du die Stadt und stellst die Reise ein. Der Rest kann warten.',
        140,
      ),
    },
    {
      hint: 'live_hud',
      demoTitle: 'Live-Anzeige',
      text: clampTour(
        'Wieder auf dem Homescreen: oben die Live-Anzeige für Tipps, News und Erinnerungen — vor allem oben links.',
        160,
      ),
    },
    {
      hint: 'mic',
      demoTitle: 'Mikrofon',
      text: clampTour(
        'Und das Herzstück bin ich. Tipp aufs Mikro — zum Beispiel wo du Eis essen kannst, wo ein günstiges Hotel liegt, oder wann die Bahn fährt. Wenn was hakt, sag einfach Bescheid.',
        240,
      ),
    },
    {
      hint: 'none',
      text: clampTour(`Viel Spaß in ${city}.`, 80),
    },
  ];
}

/**
 * Speech-Stream für die Erklärung: Fast-Hook zuerst, dann Phrase-Chunks
 * (wachsender Prefetch in der TTS-Queue).
 */
export async function* explanationSpeechChunkStream(
  segments: GuidedTourSegment[],
): AsyncGenerator<string, void, unknown> {
  for (const seg of segments) {
    const line = seg.text?.trim();
    if (!line) continue;
    const parts = splitTextToStreamingChunks(line);
    if (parts.length === 0) {
      yield line;
      continue;
    }
    for (const p of parts) {
      if (p?.trim()) yield p.trim();
    }
  }
}

function normTourSpeech(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Welches Tour-Segment die Stimme gerade spricht (akkumulierte Chunks). */
export function explanationSegmentIndexForSpoken(
  spoken: string,
  segments: Array<{ text: string }>,
): number {
  if (segments.length === 0) return 0;
  const spokenLen = normTourSpeech(spoken).length;
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const len = normTourSpeech(segments[i]!.text).length;
    const end = acc + len;
    if (spokenLen <= end || i === segments.length - 1) return i;
    acc = end + 1;
  }
  return segments.length - 1;
}

/** Orte-Sheet erst, wenn die Stimme den zweiten Teil der Karten-Erklärung erreicht. */
export function explanationPassportPlacesCueReached(
  spoken: string,
  segments: Array<{ hint: string; text: string }>,
): boolean {
  const idx = segments.findIndex((s) => s.hint === 'passport');
  if (idx < 0) return false;
  const cur = explanationSegmentIndexForSpoken(spoken, segments);
  if (cur > idx) return true;
  if (cur < idx) return false;
  const blob = normTourSpeech(spoken);
  if (/unten bei orte|kategorien wählen|vorschläge anschauen/.test(blob)) {
    return true;
  }
  let acc = 0;
  for (let i = 0; i < idx; i++) {
    acc += normTourSpeech(segments[i]!.text).length + 1;
  }
  const len = Math.max(1, normTourSpeech(segments[idx]!.text).length);
  return (normTourSpeech(spoken).length - acc) / len >= 0.72;
}

/**
 * Speech-Cursor für die Erklärung: Visuals folgen echten TTS-Chunks,
 * nicht einer Zeichen-Stoppuhr (die der Stimme davoneilt).
 */
export function createExplanationSpeechCursor(
  segments: Array<{ hint: string; text: string }>,
): {
  pushChunk: (text: string) => void;
  segmentIndex: () => number;
  passportPlacesCue: () => boolean;
  waitForSegment: (index: number, isActive: () => boolean) => Promise<void>;
} {
  let spoken = '';
  const waiters: Array<() => void> = [];
  const wake = () => {
    const w = waiters.splice(0);
    for (const fn of w) fn();
  };
  return {
    pushChunk(text: string) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (!t) return;
      spoken = spoken ? `${spoken} ${t}` : t;
      wake();
    },
    segmentIndex() {
      return explanationSegmentIndexForSpoken(spoken, segments);
    },
    passportPlacesCue() {
      return explanationPassportPlacesCueReached(spoken, segments);
    },
    async waitForSegment(index: number, isActive: () => boolean) {
      while (isActive() && explanationSegmentIndexForSpoken(spoken, segments) < index) {
        await Promise.race([
          new Promise<void>((r) => waiters.push(r)),
          new Promise<void>((r) => setTimeout(r, 100)),
        ]);
      }
    },
  };
}

/** Fallback-Halt, falls Chunk-Events ausbleiben (expo-speech / Stream-Fail). */
export function explanationSegmentHoldMs(text: string): number {
  return estimateSpeechDurationMs(text) + 420;
}

/** Drei Start-Vorschläge nach der Tour (optional / Hilfe-Chips). */
export function buildPostTourHelpActions(cityName: string | null | undefined): Array<{
  label: string;
  prompt: string;
}> {
  const city = (cityName ?? '').trim() || 'hier';
  const pack = cityDemoPack(cityName);
  return [
    {
      label: 'Was kann ich sehen?',
      prompt: `Was kann ich jetzt in ${city} sehen — recherchiere 3 starke Tipps und gib mir passende Buttons.`,
    },
    {
      label: 'Restaurant-Tipp',
      prompt: `Empfiehl mir jetzt ein gutes Restaurant in ${city}: suche konkrete Orte raus, kurz warum sie passen, und gib Route- und Speisekarten-Buttons wenn möglich.`,
    },
    {
      label: `Mehr zu ${pack.landmark}`,
      prompt: `Erzähl mir mehr zu ${pack.landmark} in ${city} — Geschichte und was man dort jetzt machen kann.`,
    },
  ];
}
