/**
 * Geführte Feature-Tour nach Setup — SSOT für Sprache + Demo-Hints.
 * Kompakt, ~0,5 s Pause zwischen Abschnitten (Runner), echte UI-Demos.
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

/** Regionale Begrüßung nach Stadt / Region. */
export function regionalGreeting(cityName: string | null | undefined): string {
  const c = (cityName ?? '').toLowerCase();
  if (
    /hamburg|prisdorf|schleswig|kiel|lübeck|lubeck|bremen|niedersachsen|emden|flensburg|rostock|wismar|stralsund|sylt|wangerooge|norderney|helgoland|cuxhaven|oldenburg|hannover/.test(
      c,
    )
  ) {
    return 'Moin';
  }
  if (
    /münchen|munchen|bayern|nürnberg|nurnberg|augsburg|regensburg|passau|stuttgart|baden|freiburg|ulm|konstanz|salzburg|innsbruck|wien/.test(
      c,
    )
  ) {
    return 'Servus';
  }
  if (/köln|koln|düsseldorf|dusseldorf|rhein|ruhr|essen|dortmund|bonn/.test(c)) {
    return 'Hallo';
  }
  if (/berlin|leipzig|dresden|potsdam|magdeburg/.test(c)) {
    return 'Hallo';
  }
  return 'Hallo';
}

export type CityDemoPack = {
  landmark: string;
  intro: string;
  highlights: string;
  timelineStops: [string, string, string];
  /** Kurzer Aktivitäts-Teaser bei gutem Wetter */
  fairWeatherTeaser: string;
};

/** Berühmtes Ensemble + Kurz-Intro + Timeline-Beispiele je Stadt. */
export function cityDemoPack(cityName: string | null | undefined): CityDemoPack {
  const c = (cityName ?? '').toLowerCase();
  if (/hamburg/.test(c)) {
    return {
      landmark: 'Elbphilharmonie',
      intro:
        'Hamburg ist Hafenstadt mit Speicherstadt, Elbe und einer Skyline, die sich ständig neu erfindet.',
      highlights:
        'Unbedingt mal sehen: Elbphilharmonie, Speicherstadt und die Landungsbrücken.',
      timelineStops: ['Elbphilharmonie', 'Speicherstadt', 'Landungsbrücken'],
      fairWeatherTeaser: 'kurze Runde am Hafen oder hoch zur Elphi-Plaza',
    };
  }
  if (/berlin/.test(c)) {
    return {
      landmark: 'Brandenburger Tor',
      intro:
        'Berlin ist Geschichte und Gegenwart auf engstem Raum — Kieze, Museen, große Plätze.',
      highlights:
        'Klassiker: Brandenburger Tor, Museumsinsel und ein Spaziergang am Spreeufer.',
      timelineStops: ['Brandenburger Tor', 'Museumsinsel', 'East Side Gallery'],
      fairWeatherTeaser: 'Spaziergang am Spreeufer oder ein Kaffee im Freien',
    };
  }
  if (/münchen|munchen/.test(c)) {
    return {
      landmark: 'Marienplatz',
      intro:
        'München mischt Traditionsbiergarten und Großstadt — Altstadt, Parks und Alpenblick.',
      highlights: 'Muss-Sees: Marienplatz, Englischer Garten und die Pinakotheken.',
      timelineStops: ['Marienplatz', 'Englischer Garten', 'Deutsches Museum'],
      fairWeatherTeaser: 'Schlaufe durch den Englischen Garten',
    };
  }
  if (/prisdorf/.test(c)) {
    return {
      landmark: 'Bahnhof Prisdorf',
      intro:
        'Prisdorf ist gemütliches Schleswig-Holstein — klein, grün, und wenn du willst in null Komma nix in Hamburg. Der Bahnhof ist dein Startpunkt, nicht die große Show.',
      highlights:
        'Von hier raus in die Marsch, rein ins Dorf — oder einfach den Zug nehmen, wenn die Stadt ruft. Kein Stress, kein Touristen-Zirkus.',
      timelineStops: ['Bahnhof Prisdorf', 'Dorfkern', 'Abendsonne am Feldrand'],
      fairWeatherTeaser: 'kurze Runde durchs Dorf oder raus an den Feldrand',
    };
  }
  if (/pinneberg/.test(c)) {
    return {
      landmark: 'Drostei',
      intro:
        'Pinneberg mischt Kleinstadt-Ruhe mit schneller Anbindung nach Hamburg — und der Drostei als Herzstück.',
      highlights: 'Schau dir die Drostei an, den Stadtpark und die Fußgängerzone.',
      timelineStops: ['Drostei', 'Stadtpark', 'Fußgängerzone'],
      fairWeatherTeaser: 'Café vor der Drostei oder eine Runde Stadtpark',
    };
  }
  if (/köln|koln/.test(c)) {
    return {
      landmark: 'Kölner Dom',
      intro: 'Köln lebt vom Dom, dem Rhein und einer lockeren, offenen Stimmung.',
      highlights: 'Pflicht: Dom, Rheinboulevard und die Altstadt um den Heumarkt.',
      timelineStops: ['Kölner Dom', 'Rheinboulevard', 'Alter Markt'],
      fairWeatherTeaser: 'Rheinboulevard oder Altstadt-Bummel',
    };
  }
  const city = (cityName ?? '').trim() || 'deiner Stadt';
  return {
    landmark: `Wahrzeichen von ${city}`,
    intro: clampChars(
      `${city} steckt voller Ecken, die man am besten zu Fuß entdeckt — Geschichte, Plätze und lokale Treffpunkte.`,
      150,
      200,
    ),
    highlights: `Schau dir das berühmteste Ensemble an, den zentralen Platz und einen lokalen Lieblingsort.`,
    timelineStops: [
      `Zentrum ${city}`,
      'Lokales Highlight',
      'Sonnenuntergang',
    ],
    fairWeatherTeaser: 'kurze Runde draußen, solange es so bleibt',
  };
}

function prefLabel(id: string): string {
  const hit = EXPERIENCE_CARDS.find((c) => c.id === id);
  if (hit?.labelDe) return hit.labelDe.replace(/\s*&\s*.*$/, '').trim();
  return id.replace(/_/g, ' ');
}

/** Max. 2–3 Interessen als natürliche Phrase — keine ID-Liste. */
function interestPhrase(profile: UserProfile): string {
  const likes: string[] = [];
  for (const [k, v] of Object.entries(profile.experiencePrefs ?? {})) {
    if (v === 'yes') likes.push(prefLabel(k));
  }
  const want = (profile.wantToExperience ?? '').trim();
  if (want && want.length <= 80) {
    return want.replace(/\s+/g, ' ');
  }
  if (likes.length === 0) return '';
  const top = likes.slice(0, 3);
  if (top.length === 1) return top[0]!;
  if (top.length === 2) return `${top[0]} und ${top[1]}`;
  return `${top[0]}, ${top[1]} und ${top[2]}`;
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
    return `Essen: ich passe auf ${allergy.join(' und ')} auf`;
  }
  if (diet.length) {
    return `Essen: ${diet.join(' und ')} im Blick`;
  }
  return '';
}

/**
 * Echte Kurz-Zusammenfassung — keine Kategorie-Vorlese, kein 1:1-AboutMe.
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
      `${name}, ich nehm dich ${vibe} — und dreh den Fokus auf ${interests}.`,
    );
  } else if (interests) {
    parts.push(`${name}, Fokus liegt bei dir klar auf ${interests}.`);
  } else if (vibe) {
    parts.push(`${name}, ich begleite dich ${vibe}.`);
  } else {
    parts.push(`${name}, Profil sitzt — wir finden unseren Rhythmus.`);
  }

  if (avoid && avoid.length <= 60) {
    parts.push(`${avoid} lassen wir links liegen.`);
  } else if (avoid) {
    parts.push('Was du meiden willst, hab ich notiert.');
  }

  if (food) parts.push(`${food}.`);

  if (profile.budgetCategory) {
    parts.push(`Budget: ${budgetSpeechFromProfile(profile)}.`);
  }

  // AboutMe nur als Signal, nie 1:1 vorlesen
  if (about.length > 12) {
    parts.push('Was du über dich erzählt hast, steckt im Hinterkopf.');
  }

  return clampTour(parts.join(' '), 280);
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
  const m = (summary ?? '').match(/(\d{1,2})\s*Grad/i);
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
  if (/regen/.test(line) && !/trocken bis|kein regen|kein sicheres trocken|schauer möglich/i.test(line)) {
    return false;
  }
  if (/schauer möglich|kein sicheres trocken/.test(line)) return false;
  return true;
}

function outfitHack(
  snap: WeatherSnapshot | null,
  summary: string | null,
  teaser: string,
): string {
  const temp = parseTempC(summary ?? snap?.summaryLine);
  const fair = isFairWeather(snap, summary);

  if (!fair) {
    if (snap?.isHeavyRain || /starkregen|regnet\s+stark/.test(summary ?? '')) {
      return 'Outfit: Regenlage oder Jacke — Indoor behalte ich im Auge.';
    }
    return 'Outfit-Hack: Schichten. Eine leichte Extra-Lage, dann bist du flexibel.';
  }

  // Gutes Wetter → knapper Outfit + Aktivitäts-Teaser
  if (temp != null && temp >= 24) {
    return `Outfit: leicht, Sonnenbrille rein. Teaser: ${teaser}.`;
  }
  if (temp != null && temp >= 18) {
    return `Outfit-Hack: T-Shirt plus dünne Jacke in der Tasche. Teaser: ${teaser}.`;
  }
  if (temp != null && temp <= 8) {
    return `Outfit: warm schichten. Trotzdem: ${teaser}, wenn du kurz raus willst.`;
  }
  return `Outfit-Hack: Schichten, leicht starten. Teaser: ${teaser}.`;
}

function weatherSpeech(
  city: string,
  stay: 'today' | 'weekend' | 'few_days',
  summary: string | null,
  snap: WeatherSnapshot | null,
  teaser: string,
): string {
  const base =
    summary?.trim() ||
    snap?.summaryLine?.trim() ||
    'Aktuell hab ich noch keinen frischen Wetter-Check.';
  const outfit = outfitHack(snap, summary, teaser);
  if (stay === 'today') {
    return clampTour(`Heute in ${city}: ${base} ${outfit}`, 320);
  }
  if (stay === 'weekend') {
    return clampTour(
      `Wochenende in ${city}: ${base} ${outfit}`,
      320,
    );
  }
  return clampTour(`In ${city}: ${base} ${outfit}`, 320);
}

export type BuildTourOpts = {
  profile: UserProfile;
  weatherSummary?: string | null;
  weatherSnapshot?: WeatherSnapshot | null;
};

/**
 * Komplette Erklärung: Welcome → Profil → Stadt → Wetter → App-Demo → Hands-free → Hilfe.
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
      weatherSummary: getCachedWeatherSummary(),
      weatherSnapshot: getCachedWeatherSnapshot(),
    }).map((s) =>
      s.landmarkName ? s : { ...s, landmarkName: pack.landmark },
    );
  }

  const profile = opts.profile;
  const city = (profile.cityName ?? profile.cityId ?? 'deiner Stadt').trim();
  const name = profile.firstName.trim() || 'du';
  const greet = regionalGreeting(city);
  const pack = cityDemoPack(city);
  const stay = stayWindowHint(profile);
  const snap = opts.weatherSnapshot ?? getCachedWeatherSnapshot();
  const weather = weatherSpeech(
    city,
    stay,
    opts.weatherSummary ?? getCachedWeatherSummary(),
    snap,
    pack.fairWeatherTeaser,
  );
  const micMode = profile.micListenMode === 'dont_hear' ? 'tip' : 'hold';

  return [
    {
      hint: 'none',
      text: clampTour(
        `${greet} ${name} — geschafft. Willkommen in ${city}. Kurz und gemütlich, was ich mir gemerkt hab — ohne Manual-Gedresche.`,
        280,
      ),
    },
    {
      hint: 'none',
      text: paraphraseProfile(profile),
    },
    {
      hint: 'none',
      text: clampTour(
        `${clampChars(pack.intro, 120, 220)} ${pack.highlights}`,
        360,
      ),
    },
    {
      hint: 'none',
      text: weather,
    },
    {
      hint: 'none',
      text: clampTour(
        `Und jetzt die App — einmal gesehen, dann darfst du mich auch einfach ignorieren und loslaufen.`,
        160,
      ),
    },
    {
      hint: 'module1',
      demoTitle: 'Vor Ort',
      landmarkName: pack.landmark,
      text: clampTour(
        `Du schlenderst durch ${city}. Kommst du an etwas Spannendes — zum Beispiel ${pack.landmark} — melde ich mich von allein und erzähl dir was dazu.`,
      ),
    },
    {
      hint: 'bullets',
      demoTitle: 'Stichpunkte',
      landmarkName: pack.landmark,
      text: clampTour(
        `Danach ein paar Stichpunkte — der schnelle Überblick, ohne Essay.`,
      ),
    },
    {
      hint: 'actions',
      demoTitle: 'Action-Buttons',
      landmarkName: pack.landmark,
      text: clampTour(
        `Darunter Buttons: Route, Speisekarte, mehr Infos — tippen statt tippen und suchen.`,
      ),
    },
    {
      hint: 'mic',
      demoTitle: 'Mikrofon · Rückfragen',
      text: clampTour(
        micMode === 'tip'
          ? `Rückfragen? Kurz aufs Mikro tippen und schreiben.`
          : `Rückfragen? Mikro tippen zum Tippen — oder halten und sprechen. Links wischen startet Live-Chat, rechts fixiert.`,
      ),
    },
    {
      hint: 'live_hud',
      demoTitle: 'Live-Anzeige',
      text: clampTour(
        `Oben links die Live-Anzeige: Ort, Tipps, Countdowns. Tippen lädt Tipps — zum Beispiel Parkticket, Wecker oder „Brauchst du Akku?“.`,
        320,
      ),
    },
    {
      hint: 'timeline',
      demoTitle: 'Timeline',
      text: clampTour(
        `Oben rechts der Kalender: Timeline. Oben Erlebtes, darunter Planung — hier mit ${pack.timelineStops[0]}, ${pack.timelineStops[1]}, ${pack.timelineStops[2]}.`,
        360,
      ),
    },
    {
      hint: 'settings',
      demoTitle: 'Einstellungen',
      text: clampTour(
        `Daneben das Zahnrad — Stimme, Profil, Trigger. Gleich öffne ich’s kurz.`,
        200,
      ),
    },
    {
      hint: 'settings_panel',
      demoTitle: 'Einstellungen offen',
      text: clampTour(
        `Hier drin: Einrichtung, Stadt wechseln, Audio, Erklärungen, Feedback. Fertig — ich schließ wieder.`,
        240,
      ),
    },
    {
      hint: 'passport',
      demoTitle: 'Stempelkarte',
      text: clampTour(
        `Unter dem Zahnrad das Karten-Icon: Stempelkarte — Fog-of-War und was du schon erkundet hast. Nicht die Live-Zeile tippen, sondern genau dieses Icon.`,
        320,
      ),
    },
    {
      hint: 'help_prompt',
      demoTitle: 'Hands-free',
      text: clampTour(
        `Am besten hands-free: Kopfhörer rein, Handy in die Tasche. In-Ear-Taste kann Findus starten, wenn du’s in den Einstellungen an hast. Frag mich einfach — Essen, Weg, Gebäude vor dir. Ich übernehme.`,
        400,
      ),
    },
  ];
}

/** Drei Start-Vorschläge nach der Tour. */
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
      label: 'Einfach loslaufen',
      prompt: `Lass uns in ${city} einfach loslaufen — starte mit etwas Spannendem in der Nähe, z. B. Richtung ${pack.landmark}, und navigiere mich dahin.`,
    },
  ];
}
