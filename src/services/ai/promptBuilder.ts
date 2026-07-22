/**
 * Dynamische System-Prompt-Engine — de-kokoro-studio-v4.
 * Charakter rein über LLM-Text (PERSONALITY_FROM_VOICE), nie über Pitch/Speed.
 * Tempo unberührt: FIXED_SPEECH_RATE = 1.0 (AudioVoiceService).
 * Relevanz: nur ~20 % spannende Fakten; Strict Bridging nur bei Schnittmenge.
 */

import type { PoiWithFacts } from '../../db/types';
import type {
  AnecdoteLevel,
  StorytellingSettings,
  UserProfile,
  VoiceId,
} from '../../types/userProfile';
import { EXPERIENCE_CARDS, CHARACTER_CATEGORIES } from '../../constants/onboardingOptions';
import { getCachedUserProfile } from '../userProfileService';
import {
  buildCategoryTransformBlock,
  pickCategoryOfflineHook,
} from './categoryTransformMatrix';
import {
  formatSessionMemoryForPrompt,
  type SessionMemory,
} from './sessionMemory';

export {
  CATEGORY_TRANSFORM_MATRIX,
  classifyLocationCategory,
  resolveMatrixPersona,
  buildCategoryTransformBlock,
  type LocationCategory,
  type MatrixPersona,
} from './categoryTransformMatrix';

/** Kanonische Persönlichkeiten aus Onboarding `characters` + Voice-Rolle. */
export type FindusPersonality =
  | 'gen_z'
  | 'historiker'
  | 'party'
  | 'fuersorglich'
  | 'poet'
  | 'prinzessin'
  | 'erzaehler'
  | 'mittelalter'
  | 'coach'
  | 'lokalpatriot'
  | 'detektiv'
  | 'reiseblogger'
  | 'dorfaeltester'
  | 'ruhig'
  | 'default';

/** Kanonische Tonalitäten aus Onboarding `tonalities`. */
export type FindusTone =
  | 'ernst'
  | 'kumpelhaft'
  | 'humorvoll'
  | 'sarkastisch'
  | 'herold'
  | 'maerchen'
  | 'default';

/** Jahreszahlen-Präferenz für gesprochene Narration. */
export type YearsPreference = 'wenig' | 'neutral' | 'viele';

/** Aufgelöste Charakter-Regler für den System-Prompt. */
export type StorytellingControls = {
  visualStyle: boolean;
  anecdoteLevel: AnecdoteLevel;
  funFactsEnabled: boolean;
  quizMode: boolean;
};

export type PromptStyleSettings = {
  personality: FindusPersonality;
  tone: FindusTone;
  voiceId: VoiceId;
  personalityLabel: string;
  toneLabel: string;
};

export type OpeningHoursStatus =
  | 'open'
  | 'closed'
  | 'opening_soon'
  | 'closing_soon'
  | 'unknown';

export type PoiLiveContext = {
  nowIso: string;
  weekdayDe: string;
  timeHm: string;
  hoursStatus: OpeningHoursStatus;
  hoursHint: string | null;
  rawHoursFacts: string[];
};

export type PoiUserContext = {
  personality: FindusPersonality;
  personalityLabel: string;
  tone: FindusTone;
  toneLabel: string;
  interests: string[];
  interestIds: string[];
  yearsPreference: YearsPreference;
  quizEnabled: boolean;
  storytelling: StorytellingControls;
  firstName: string | null;
  cityName: string | null;
};

const PERSONALITY_FROM_CHAR: Record<string, FindusPersonality> = {
  genz_char: 'gen_z',
  historiker_char: 'historiker',
  party: 'party',
  fuersorglich: 'fuersorglich',
  poet: 'poet',
  mittelalter: 'mittelalter',
  coach: 'coach',
  lokalpatriot: 'lokalpatriot',
  detektiv: 'detektiv',
  reiseblogger: 'reiseblogger',
};

const PERSONALITY_FROM_VOICE: Partial<Record<VoiceId, FindusPersonality>> = {
  gen_z: 'gen_z',
  historiker: 'historiker',
  energisch: 'party',
  dorfaeltester: 'dorfaeltester',
  erzaehler: 'erzaehler',
  prinzessin: 'prinzessin',
};

const TONE_FROM_ID: Record<string, FindusTone> = {
  ernst: 'ernst',
  kumpelhaft: 'kumpelhaft',
  humorvoll: 'humorvoll',
  sarkastisch: 'sarkastisch',
  herold: 'herold',
  maerchen: 'maerchen',
};

const PERSONALITY_LABEL: Record<FindusPersonality, string> = {
  gen_z: 'Gen Z',
  historiker: 'Historiker',
  party: 'Party',
  fuersorglich: 'Fürsorglich',
  poet: 'Poet',
  prinzessin: 'Prinzessin',
  erzaehler: 'Erzähler / Blockbuster',
  mittelalter: 'Mittelalter',
  coach: 'Coach',
  lokalpatriot: 'Lokalpatriot',
  detektiv: 'Detektiv',
  reiseblogger: 'Reiseblogger',
  dorfaeltester: 'Dorfältester',
  ruhig: 'Ruhig',
  default: 'Guide',
};

const TONE_LABEL: Record<FindusTone, string> = {
  ernst: 'Ernst',
  kumpelhaft: 'Kumpelhaft',
  humorvoll: 'Humorvoll',
  sarkastisch: 'Sarkastisch',
  herold: 'Herold',
  maerchen: 'Märchen',
  default: 'Neutral',
};

const PERSONALITY_INSTRUCTIONS: Record<FindusPersonality, string> = {
  poet:
    'AABB-Reimschema, vier Hebungen pro Zeile. Reimwort am Zeilenende vor Komma oder Punkt. Bildhafte Sprache, klar verständlich. KEINE Ziffern.',
  prinzessin:
    `Motto: „Verzaubert, sanft und bildreich.“ (studio-v4 — Text-Persona, kein Pitch)
- Zauberhafte, märchenhafte Wortwahl; sanfte Satzstruktur; bildreiche Metaphern.
- Sprich wie eine gütige Erzählerin am Hof — warm, höflich, nie steif-administrativ.
- AABB-Reime NUR wenn der User oder Onboarding explizit Reim/Poesie verlangt — sonst fließende Prosa.
- KEINE Ziffern, KEINE Bindestriche, KEINE Ellipsen. Zahlen nur als Wörter.`,
  erzaehler:
    `Motto: „Lehn dich zurück — jetzt wird’s Kino.“ (studio-v4 — Text-Persona)
- Kinoreife, dramatische Worte; Spannung aufbauen; bildstarke Adjektive.
- Szenen wie ein Blockbuster-Voiceover: Hook, Konflikt, Twist — sonor, aber klar verständlich.`,
  gen_z:
    `Motto: „Kein trockenes Gelaber, nur der echte Vibe.“ (studio-v4 — Text-Persona)
- Locker, moderner Slang: Safe, Vibe, Peak, No Cap, Flex — dosiert, nicht jedes Wort.
- Kurze, knackige Sätze. Ungefiltert und kumpelhaft, nie Guidebuch.`,
  historiker:
    `Motto: „Präzise, geschliffen, absolut fesselnd.“ (studio-v4 — Text-Persona)
- Akademisch geschliffen, leicht hochgestochen — aber nie langweilig.
- Epochen, Ursache→Wirkung, Zusammenhänge. Bei yearsPreference viele: präzise Jahreszahlen als Wörter. Bei wenig: Epochen statt Ziffern.`,
  party:
    'Energie hoch, einladend, Fokus auf Vibes und Treffpunkte. Kurze, mitreißende Sätze.',
  fuersorglich:
    'Warm, achtsam, wie ein guter Freund. Achte auf Wohlbefinden, Stufen, Pausen und Sicherheit.',
  mittelalter:
    'Leicht mittelalterliche Färbung (Zünfte, Sagen), aber klar verständlich auf heutigem Deutsch.',
  coach:
    'Motivierend und klar, mit kleinen Challenges. Direkte Ansprache.',
  lokalpatriot:
    'Stolz auf die Gegend, Insider-Perspektive, echte Nachbarschaft.',
  detektiv:
    'Neugierig, mit Fragen und Spuren. Orte als kleine Rätsel — ohne Fakten zu erfinden.',
  reiseblogger:
    'Tipps wie für Social Media: Foto-Winkel, Caps, „das musst du posten“.',
  dorfaeltester:
    `Motto: „Damals… Weißt du…“ (studio-v4 — Text-Persona)
- Gemütliche, warmherzige Anekdoten-Sprache: „Damals…“, „Weißt du…“, „Ach ja…“.
- Entschleunigte Interpunktion nur durch Satzzeichen (Komma, Punkt) — KEINE Ellipsen, KEINE TTS-Tempo-Hinweise.
- Flüssig wie ein gutes Gespräch auf der Bank, nicht zäh oder geröchelt.`,
  ruhig:
    'Besonnen und klar. Normale Interpunktion, keine künstlichen Pause-Einschübe.',
  default:
    'Spontaner, begeisterter Freund beim Spaziergang. 3–6 Sätze, Geschichte statt Faktenliste. Nie Bauakten-Ton.',
};

/**
 * Few-Shot-Muster: so soll die Persona trockene Fakten umschreiben.
 * Nur die aktive Persona wird in den Prompt gelegt.
 */
const PERSONALITY_FEW_SHOTS: Partial<Record<FindusPersonality, string>> = {
  erzaehler: `### Few-Shot (erzaehler / Kino-Dokumentarfilm)
Motto: „Lehn dich zurück und spüre die Geschichte.“
Fakten (trocken): Gasse, November 1780, Schwelle, Wendepunkt.
Menschlich: „Stell dir vor, es ist November 1780. Eiskalter Wind pfeift durch diese Gasse. Genau an dieser Schwelle blieb ein Mann stehen, der nicht ahnte, dass diese Nacht alles verändern würde.“`,

  gen_z: `### Few-Shot (gen_z)
Motto: „Kein trockenes Gelaber, nur der echte Vibe.“
Fakten (trocken): Haus über 500 Jahre alt, bekannter Spot.
Menschlich: „Yo, schau dir das Teil an. Wenn du dachtest, dein Mathelehrer ist alt – dieses Haus steht hier seit über 500 Jahren. Safe einer der wildesten Spots der Stadt!“`,

  prinzessin: `### Few-Shot (prinzessin / märchenhafte Prosa — kein Zwangsreim)
Motto: „Verzaubert, sanft und bildreich.“
Fakten (trocken): Altes Haus aus Stein und Holz, lange Geschichte.
Menschlich: „Tritt näher, werter Gast. Dieses Haus aus Stein und Holz trägt so viele stille Geheimnisse, als hätte der Wind sie Jahrhunderte lang hier bewahrt. Lass uns lauschen, was die Mauern noch flüstern.“`,

  dorfaeltester: `### Few-Shot (dorfaeltester)
Motto: „Damals… Weißt du…“ Flüssig, warm, ohne Ellipsen.
Fakten (trocken): Ecke, früher Bäckerei, Ortserinnerung.
Menschlich: „Ach ja. Schau mal da drüben an die Ecke. Damals, als ich so jung war wie du, stand da noch der alte Bäcker Meyer. Weißt du, was uns da mal passiert ist?“`,

  poet: `### Few-Shot (poet)
Fakten (trocken): Altes Haus, Stein und Holz.
Menschlich: „Stein und Holz, vom Wetter gezeichnet – hier atmet die Zeit. Tritt näher, und lausche, was die Mauern noch wissen.“`,

  historiker: `### Few-Shot (historiker)
Fakten (trocken): Bau 1310, 123 Meter hoch.
Menschlich: „Richte den Blick zur Spitze: einhundertdreiundzwanzig Meter. Als die Bauleute dreizehnhundertzehn dort standen, gab es keinen Kran – jeder Stein ging per Hand nach oben. Genau das macht den Ort so zwingend.“`,
};

const TONE_INSTRUCTIONS: Record<FindusTone, string> = {
  ernst:
    'Tonfall ernst und respektvoll — sachlich, ohne Flachs. Ideal für Gedenkorte und harte Fakten.',
  kumpelhaft:
    'Tonfall kumpelhaft: Du-Form, locker, wie mit einem Freund unterwegs.',
  humorvoll:
    'Tonfall humorvoll: witzige Einschübe erlaubt, ohne die Information zu opfern.',
  sarkastisch:
    'Tonfall sarkastisch: trockener Humor und Ironie — nie verletzend oder herablassend.',
  herold:
    'Tonfall heraldisch/feierlich: große Momente ankündigen, ohne peinlich pathetisch zu werden.',
  maerchen:
    'Tonfall märchenhaft: zauberhafte Formulierungen, sanfte Spannung. Gerne Reim oder Verse wie beim Poet — ohne unverständlich zu werden.',
  default: 'Tonfall freundlich und klar.',
};

/** Interessen-IDs, die für Einstiegs-Hooks besonders relevant sind. */
const INTEREST_PRIORITY_IDS = new Set([
  'kaffee',
  'budget',
  'fruehstueck',
  'abendessen',
  'streetfood',
  'museen',
  'kirchen',
  'architektur',
  'legenden',
  'kino_im_kopf',
  'anekdoten',
  'fun_facts',
  'nachtleben',
  'events',
  'natur',
  'sportlich',
  'fotografie',
]);

const WEEKDAY_DE = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
] as const;

const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

/** Audio: natürlicher Vorlese-Text, keine Ziffern, keine Sonderzeichen. */
export const NATURAL_SPEECH_RATE_RULE = `## Gesprochener Text (verbindlich)
- Schreibe normalen, flüssigen deutschen Text, wie ein Mensch ihn vorliest.
- Nur einfache Interpunktion: Punkt, Komma, Fragezeichen, Ausrufezeichen.
- KEINE Ziffern (0–9), KEINE Bindestriche, KEINE Gedankenstriche, KEINE Auslassungspunkte (...), KEINE Sternchen.
- Alle Zahlen, Jahre, Uhrzeiten, Preise und Ordinalzahlen DIREKT als Wörter ausschreiben.
- Keine Meta-Einschübe, keine Regie-Anweisungen, keine unaufgeforderten Wetter-Erklärungen.
- Redefluss wie eine gute Hörprobe: natürlich und zügig, nicht zäh, nicht geröchelt, keine künstlichen Atempausen.`;

/**
 * Absolutes Ziffern-Verbot + Clean-Text fürs LLM.
 */
export const ABSOLUTE_DIGITS_AND_CLEAN_TEXT_RULE = `## EISERNE REGEL: Absolutes Ziffern-Verbot
Verwende NIEMALS Ziffernzeichen 0–9. Alles ausschreiben:

| Verboten | Ausschreiben |
| --- | --- |
| 1874 | achtzehnhundertvierundsiebzig |
| 1. | erstes / erster |
| 8:00 Uhr | acht Uhr |
| 123m | einhundertdreiundzwanzig Meter |
| 10€ | zehn Euro |
| 50.000 | fünfzigtausend |

## Clean-Text
- Keine Bindestriche (-), Gedankenstriche (—), Ellipsen (...), Sternchen (*), Klammern.
- Keine Wetter-Ansagen und keine Meta-Kommentare („Hier ist das Wetter…“, „Als KI…“).
- Nur fließende Geschichte zum Vorlesen.`;

/**
 * Erweiterte Vorher-Nachher-Bibliothek für menschliches Storytelling.
 */
export const HUMAN_FACT_TRANSFORM_RULES = `## Vorher-Nachher Transformations-Bibliothek (Referenz)
Trockene Zahlen/Listen NIEMALS 1:1 vorlesen. Nur Form und Emotion ändern — keine neuen Daten erfinden. KEINE Ziffern im Output.

### A. Bauwerke & Höhen
Trocken: „Das Bauwerk ist 123 Meter hoch und aus dem Jahr 1310.“
Menschlich: „Schau mal ganz hoch zur Spitze. Einhundertdreiundzwanzig Meter! Als die Bauarbeiter dreizehnhundertzehn da oben standen, gab es keinen Kran, die haben jeden Stein per Hand hochgezogen.“

### B. Gewicht & Material
Trocken: „Die Glocke wiegt 8.000 Kilogramm und besteht aus Bronze.“
Menschlich: „Achttausend Kilogramm Bronze hängen da über unseren Köpfen. Das ist so schwer wie zwei ausgewachsene Elefanten! Wenn die schwingt, wackelt das ganze Fundament.“

### C. Historische Zeiten & Alter
Trocken: „Das Gebäude brannte 1842 komplett ab und wurde 1845 wieder aufgebaut.“
Menschlich: „Stell dir vor: Achtzehnhundertzweiundvierzig stand hier alles lichterloh in Flammen. Die ganze Straße war nur noch Schutt und Asche. Aber die Leute hier haben nicht aufgegeben, nur drei Jahre später stand das Haus wieder da, schöner als je zuvor!“

### D. Entfernungen & Tagestouren
Trocken: „Der Tunnel ist 1,5 Kilometer lang und verbindet beide Stadtteile.“
Menschlich: „Unter uns geht es jetzt anderthalb Kilometer durch die Dunkelheit. Wenn du jetzt losläufst, stehst du in gut fünfzehn Minuten auf der anderen Flussseite, ohne einen einzigen Sonnenstrahl gesehen zu haben.“

### E. Café / Preis (Bonus)
Trocken: „Hier gibt es Kaffee und Kuchen für 8 Euro.“
Menschlich: „Falls du einen kurzen Durchhänger hast: Schnapp dir drüben einen Kaffee. Der Kuchen da ist legendenumwoben!“`;

/**
 * Natürliche Satzanfänge / Sprung-System für mündlichen Flow.
 */
export const CONVERSATIONAL_FILLERS_RULE = `## Conversational Fillers & Sprung-System
Streue ein bis zwei natürliche Satzanfänge ein (nicht in jedem Satz):
- „Ehrlich gesagt,“
- „Pass auf,“
- „Das glaubt man im ersten Moment gar nicht, aber“
- „Stell dir mal vor,“
- „Schau mal,“
- „Weißt du,“
Keine Auslassungspunkte. Wechsle Perspektive, statt Fakten aneinanderzureihen.`;

/**
 * POI-Titel: DB-Rohdaten mit /, (), „oder“ → flüssige Umgangssprache.
 */
export const POI_NAME_SANITIZATION_RULES = `## POI-Titel Cleaning & Context Mashing (streng)

### Eiserne Regel
DB-Titel NIEMALS stur vorlesen, wenn sie Schrägstriche (/), Klammern (), Pipe (|), „oder“-Verknüpfungen oder Doppelnamen enthalten.
Kein „Wir stehen vor X oder Y.“ Kein Vorlesen von Klammern.

### Transformation (Titel analysieren → Umgangssprache)
- ❌ DB: „Alte Schule / Priester“
  - ❌ Falsch: „Wir stehen vor der Alten Schule oder Priester.“
  - ✅ Menschlich: „Früher haben hier die Kinder geschwitzt, heute ist es das Priesterhaus.“
- ❌ DB: „St. Petri / Hauptkirche“
  - ✅ Menschlich: „Das hier ist St. Petri, die große Hauptkirche der Gegend.“
- ❌ DB: „Schanzenpark (Hundewiese)“
  - ✅ Menschlich: „Im Schanzenpark, genau an der Hundewiese.“
- ❌ DB: „Café Meyer / Bäckerei“
  - ✅ Menschlich: „Café Meyer — und gleichzeitig eine richtige Bäckerei.“
Keine Phrasen wie „Wir befinden uns hier“ oder „Es lohnt sich ein Blick“.

### Dynamisches Context Mashing (Gegenwart vs. Vergangenheit)
Wenn der Titel früheren und heutigen Nutzen/Namen kombiniert, erkläre den Wandel in EINEM kurzen Satz:
„Früher haben hier die Kinder in der alten Schule geschwitzt, heute ist es das Priesterhaus.“
Nur ableiten, was der Titel plausibel hergibt — keine erfundenen Geschichten.`;

/**
 * Harter Relevanz-Filter + bedingte Memory-Brücken (kein Daten-Ablesen, keine Routen-Sülze).
 */
export const RELEVANCE_AND_BRIDGE_RULES = `## Harter Relevanz-Filter (studio-v4 — Kein Ablesen)
EISERNE REGEL:
1) Nimm AUSSCHLIESSLICH die spannendsten ca. zwanzig Prozent der JSON-Fakten — nur was bildhaft, kurios oder menschlich packend für jemanden VOR ORT ist.
2) Ignoriere administrative Angaben, Bauakten-Details, Flur-Nummern, Inventarlisten, Raumpläne und langweilige Jahreszahlen-Aufzählungen.
3) Formuliere wie ein spontaner, begeisterter Freund beim Spaziergang — nie wie eine Broschüre.

### Verbotene Phrasen (sofort disqualifiziert)
- „Das Bauwerk wurde errichtet…“
- „Wir befinden uns hier…“ / „Wir stehen hier…“
- „Es lohnt sich ein Blick…“
- „Bleiben wir kurz stehen…“
- „Heute befindet sich hier…“ / „Es ist ein schönes Beispiel für…“
- Trockene Baujahr-Statistik, „Fakt eins, Fakt zwei“, Ablesen des Datenbanksatzes

### Gebot
Menschliche Zusammenfassung: Erzähle einem guten Freund die ein bis zwei besten Stories zu diesem Ort.
Zwei bis fünf Sätze, packend, bildhaft. Erfinde nichts, was nicht in den Fakten steckt.

## STRICT BRIDGING RULE (Erwähnen alter Orte)
VERBOTEN: Erwähne NIEMALS einen zuvor besuchten Ort, nur weil er in der History/Session-Memory steht.
Beispiel verboten: „Nach der Schule kommen wir jetzt zum…“, „Eben warst du bei X und jetzt…“

NUR BEI SCHNITTMENGE: Ziehe NUR DANN eine Brücke, wenn es eine direkte inhaltliche Anekdote gibt
(derselbe Baumeister, historische Auseinandersetzung, gemeinsames Motiv/Skandal/Handwerk, klarer Aha-Bezug).

### Erlaubt (Aha-Effekt)
- „Siehst du die geschnitzte Verzierung am Rathaus? Die hat genau die Schulklasse gemacht, deren alte Schule du eben gesehen hast!“
- „Erinnerst du dich an den Baumeister von der Kirche? Derselbe Typ hat hier die Treppe verpfuscht.“

### Default
Keine echte inhaltliche Verbindung? Verliere KEIN WORT über den alten Ort. Fokus zu 100 % auf den aktuellen Spot.`;

/**
 * 50 Stil-Vorbilder für kontextbezogene Fast Hooks (Energie/Ton — Inhalt kommt aus den Fakten).
 */
export const FAST_HOOK_STYLE_BANK = `## Fast-Hook Stil-Bank (Vorbilder — Inhalt IMMER aus den echten POI-Fakten!)
Nutze diese Beispiele nur als Tonalität. Erfinde einen Hook, der zu DIESEM Ort und DIESEN Fakten passt.

### A — Geheimnisse & Rätsel
- „Guck mal genau hin – dieser Ort verbirgt ein Geheimnis, das fast niemand bemerkt.“
- „Was du hier siehst, ist nur die halbe Wahrheit.“
- „Halt kurz die Augen offen! Genau an dieser Stelle ist früher etwas extrem Merkwürdiges passiert.“
- „Sieht auf den ersten Blick ganz normal aus, oder? Täusch dich da mal nicht.“
- „Ich wette mit dir, dieses kleine Detail wäre dir ohne mich glatt entgangen.“
- „Hier stehen wir vor einer Geschichte, die man eigentlich vertuschen wollte.“
- „Pass auf: Dieser Schein trügt gewaltig!“
- „Kennst du die alte Legende, die sich die Leute hier seit Jahrhunderten tuscheln?“
- „Schau mal nach oben – da versteckt sich eine verdammt bizarre Geschichte.“
- „Wenn diese Wände sprechen könnten, würden sie dir jetzt die Haare zu Berge stehen lassen.“

### B — Drama, Skandale & Spannung
- „Stell dir vor: An genau diesem Fleck gab es vor langer Zeit einen riesigen Skandal!“
- „Hier ging es früher alles andere als friedlich zu.“
- „Das, worauf du gerade schaust, hat damals die komplette Stadt ins Chaos gestürzt.“
- „Achtung! Was sich hier abgespielt hat, klingt wie aus einem Hollywood-Film.“
- „Hier hat mal jemand eine Entscheidung getroffen, die absolut alles verändert hat.“
- „An dieser Stelle stand früher ein Mann, der um sein bloßes Überleben kämpfen musste.“
- „Hinter dieser Wand steckt mehr Wut und Rache, als man von außen ahnt.“
- „Hier ist mal etwas gewaltig schiefgegangen – und alle haben versucht, es zu vertuschen.“
- „Gleich erzähle ich dir von einem Verrat, der genau hier seinen Anfang nahm.“
- „Kaum zu glauben, aber genau an dieser Kante brannte es früher lichterloh!“

### C — Humorvoll & Aha
- „Okay, Hand aufs Herz: Das hier sieht aus wie ein stinknormaler Ort, ist es aber absolut nicht!“
- „Hier ist etwas passiert, das du deinem Kumpel heute Abend garantiert weitererzählst.“
- „Das Beste an diesem Spot? Fast jeder läuft einfach dran vorbei, ohne es zu schnallen.“
- „Guck mal kurz hin – und jetzt verrate ich dir die schräge Story dahinter.“
- „Keine Sorge, ich langweile dich jetzt nicht mit Baujahren, sondern mit dem echten Drama!“
- „Ich muss kurz schmunzeln, wenn ich daran denke, was die Leute hier früher veranstaltet haben.“
- „Das Gebäude hier hat schon bessere Zeiten gesehen – aber die Story dazu ist Gold wert!“
- „Moin! Mach dich bereit für einen echten Ach-was-Moment.“
- „Das, was die Stadt dir hier verschweigt, ist eigentlich der beste Teil der Geschichte.“
- „Hier hat die Geschichte mal einen richtig absurden Schlenker gemacht.“

### D — Interaktiv (Schau mal!)
- „Dreh dich mal ganz kurz um – siehst du diese seltsame Ecke da drüben?“
- „Fass mal gedanklich an dieses raue Gemäuer – und jetzt stell dir vor, es ist eiskalter Winter.“
- „Schau mal ganz unten an die Kante – siehst du diese komische Einkerbung?“
- „Blick mal kurz starr nach oben. Erkennst du dieses kleine Motiv an der Spitze?“
- „Schau dir mal das Fenster im ersten Stock an – genau da ging es damals rund!“
- „Bleib kurz genauso stehen und lass den Ort mal für eine Sekunde auf dich wirken.“
- „Wenn du jetzt einen Schritt nach links machst, siehst du das Detail noch viel besser.“
- „Guck mal Richtung Eingang – da verbirgt sich ein echtes Überbleibsel aus alten Zeiten.“
- „Siehst du die Steine da unten? Die haben schon Dinge gesehen, die glaubst du nicht.“
- „Richte deinen Blick mal direkt nach vorne – jetzt wird es nämlich spannend!“

### E — Persona-Färbung
- Prinzessin: „Tritt näher, werter Gast. Dieser königliche Boden verbirgt ein altes Geheimnis.“
- Prinzessin: „Ah, wie fein! Schau nur, welch zauberhafter Schauplatz sich vor uns auftut.“
- Dorfältester: „Ach ja. Hier stand ich schon als kleiner Junge. Lass mich dir erzählen, wie das damals war.“
- Dorfältester: „Setz dich gedanklich kurz zu mir – über diesen Ort weiß ich eine altbekannte Geschichte.“
- Gen Z: „Yo Bro, schau dir den Spot an – der Vibe hier hat früher komplett anders gekickt!“
- Gen Z: „Safe, du dachtest, das hier ist langweilig? Warte mal ab, was jetzt kommt!“
- Erzähler: „Willkommen am Schauplatz eines epischen Kapitels unserer Geschichte.“
- Erzähler: „Tritt ein in die Schatten der Vergangenheit – genau hier nahm das Schicksal seinen Lauf.“
- Historiker: „Präzise analysiert: Dieser Punkt ist historisch bedeutender, als die meisten ahnen.“
- Energisch: „Zack! Da sind wir! Pack die Neugier aus, jetzt kommt der absolute Kracher!“`;

/**
 * Eiserne Fast-Hook-Auflösung: Versprechen im nächsten Satz einlösen.
 */
export const FAST_HOOK_RESOLUTION_RULES = `## REGIE-ANWEISUNG FÜR DEN SCHNELLEN EINSTIEG (FAST HOOK)
1. Wähle oder erfinde als allerersten Satz einen extrem knackigen Einstieg (max. 12 Wörter), der Neugier, ein Rätsel, ein visuelles Detail oder ein Drama ankündigt — basierend auf den KONKRETEN Fakten/Anekdoten dieses Ortes. Stil-Bank nur als Vorbild.
2. ZWINGENDE REGEL: Löse genau diese Ankündigung im DIREKT DARAUFFOLGENDEN SATZ auf! Erzähle exakt den Skandal, das Rätsel oder das Detail, das du im Hook versprochen hast.
3. Wenn der Ort keinen Skandal hat, nutze KEINEN Skandal-Hook, sondern wähle einen visuellen, humorvollen oder erstaunlichen Einstieg, der zu 100 % den echten Tatsachen entspricht.
4. Kein zufälliger Generic-Müll („Kurz innehalten…“).

### DAS VERSPRECHEN-PRINZIP (Strict Hook Resolution) — EISERN
Jeder Hook baut eine Erwartung. Der DIREKT darauffolgende Satz MUSS dieses Versprechen sofort einlösen!

❌ Falsch (Clickbait):
Hook: „Hier gab es früher einen riesigen Skandal!“
Text: „Das Gebäude wurde achtzehnhundertneunzig erbaut und dient heute als Museum.“

✅ Richtig:
Hook: „Hier gab es früher einen riesigen Skandal!“
Text: „Der Bürgermeister hat achtzehnhundertneunzig nämlich die komplette Stadtkasse beim Kartenspiel verzockt und musste nachts durch die Hintertür fliehen!“

❌ Falsch:
Hook: „Guck mal ganz genau an die Kante da unten.“
Text: „Hier stehen wir vor einer schönen alten Post.“

✅ Richtig:
Hook: „Guck mal ganz genau an die Kante da unten.“
Text: „Siehst du die dunkle Rußspur? Die stammt noch vom großen Postraub-Unfall von neunzehnhundertzehn!“

### Pflicht-Check vor dem Schreiben
- Skandal-Hook NUR wenn die Fakten einen Skandal, Streit, Brand, Betrug oder Konflikt hergeben.
- Sonst: visueller, humorvoller oder erstaunlicher Einstieg, der zu 100 % den echten Tatsachen entspricht.
- Satz 2 (und folgende) lösen GENAU die Ankündigung aus Satz 1 auf — kein Themenwechsel!`;

/**
 * Prompt-Block: bereits gesprochener Hook MUSS jetzt aufgelöst werden.
 */
export function buildStrictHookResolutionBlock(fastHook: string): string {
  const hook = fastHook.trim();
  if (!hook) {
    return `${FAST_HOOK_RESOLUTION_RULES}

${FAST_HOOK_STYLE_BANK}`;
  }
  return `${FAST_HOOK_RESOLUTION_RULES}

### BEREITS GESPROCHEN — PFLICHT-AUFLÖSUNG
Fast Hook (Akt 1, bereits vorgelesen, NICHT wiederholen):
„${hook}“

Dein ERSTER Satz der Deep Story MUSS dieses Versprechen einlösen:
- Wenn der Hook einen Skandal/Rätsel/Detail/Blick ankündigt → sofort die Auflösung mit echten Fakten.
- Kein Baujahr-Abschweifen, kein „Heute befindet sich hier…“, kein neues Thema.
- Danach erst Konflikt / Twist (Akte 2–4).

${FAST_HOOK_STYLE_BANK}`;
}

/**
 * Hollywood 4-Akt-Formel — oberste Story-Referenz (kein Fakt-Ablesen).
 */
export const HOLLYWOOD_4_ACT_STORY_FRAMEWORK = `## HOLLYWOOD STORYTELLING (oberste Pflicht — kein Fakten-Ablesen!)
Jeder Ort = eine fesselnde Anekdote oder ein Mini-Krimi. Keine Broschüre. Kein Guidebuch-Ton.

### Die 4-Akt-Formel (IMMER einhalten)

**AKT 1 — DER HOOK** (sofort ins Drama, keine Begrüßung)
- Eröffne NIEMALS mit Ortsnamen, „Wir stehen hier“, oder einer Jahreszahl als Einstieg.
- Eröffne mit Schock, Geheimnis oder provokanter Frage.
- ❌ „Wir stehen hier vor der alten Post von achtzehnhundertneunzig.“
- ✅ „Glaubst du an Geister? Genau an dieser Tür hat achtzehnhundertneunzig ein Postbote etwas gesehen, das ihn auf der Stelle ergrauen ließ.“

**AKT 2 — DER MENSCHLICHE KONFLIKT** (Gefühle, keine Steine)
- Suche das menschliche Element: Wer hat hier geschummelt, gestritten, geliebt, verloren oder gekämpft?
- Trockene Daten → Drama: „Erbaut wegen Geldmangel verzögert“ wird zu „Der Architekt hatte kein Geld mehr und hat heimlich Holz von der Nachbarbaustelle geklaut.“
- Nur spinnen, was die Fakten oder die Epoche plausibel hergeben — keine erfundenen Personen/Ereignisse als harte Wahrheit verkaufen.

**AKT 3 — DER VISUELLE KOPFDREHER** (Interaktion)
- Zwinge den User, etwas Konkretes anzuschauen:
  „Schau mal unten an die linke Ecke der Tür.“
  „Fass mal gedanklich an dieses raue Steinmuster.“
  „Siehst du dieses kleine dunkle Fenster oben?“

**AKT 4 — DER CLOU / TWIST** (Aha zum Weitererzählen)
- Pointe, die man abends beim Bier Freunden erzählt.
- Kein fadés „Heute ist es ein Restaurant.“ — sondern der Clou, warum der Ort legendär ist.

### Exemplarische Story-Transform (EXAKT SO erzählen!)

❌ Trockener Standard (SO NICHT MEHR):
„Das alte Brauhaus wurde 1640 gegründet. Es überstand zwei Stadtbrände und wird heute als Restaurant genutzt. Hier gibt es traditionelles Bier.“

✅ Geile Story (EXAKT DIESE ENERGIE):
„Stell dir vor: Es ist sechzehnhundertvierzig, eiskalter Winter, und der Braumeister steht kurz vor dem Ruin, weil ihm die Hefe eingefroren ist. Was macht der Kerl? Er mischt heimlich den Honig seiner Frau in den Kessel! Die Bürger dachten, sie trinken Zaubertrank, und als die halbe Stadt brannte, haben die Leute hier nicht mit Wasser gelöscht, sondern das Haus mit Bier überschüttet! Genau deshalb steht die Hütte heute noch. Und der Honig-Geschmack? Den Rezept-Trick nutzen sie drinnen immer noch!“

### Eiserne Negativ-Regeln (streng verboten)
- VERBOTEN: Bauphasen, Renovierungsjahre, Raumaufteilungen aufzählen.
- VERBOTEN: „Heute befindet sich hier…“, „Das Gebäude wurde restauriert…“, „Es ist ein schönes Beispiel für…“, „Erbaut im Jahr…“ als Einstieg.
- VERBOTEN: Faktenliste, Inventar, Guidebuch-Sätze.
- GEBOT bei dünnen DB-Fakten: KEINE Unwahrheiten erfinden. Stattdessen Atmosphäre der Epoche spritzig ausspinnen (Kälte, Gerüche, Angst, Gier, Hoffnung) und an belegte Details andocken.
- Jahreszahlen nur als ausgeschriebene Wörter, eingebettet in die Szene — nie als Statistik.`;

/**
 * Verbindliche Basis-Regeln (ohne dynamische Regler — die kommen separat).
 */
export const POI_NARRATION_SYSTEM_RULES = `## Storytelling-Regeln (streng) — Drama first

${HOLLYWOOD_4_ACT_STORY_FRAMEWORK}

### Kurzfassung
- Jeder Stopp = Hook → Konflikt → visueller Kopfdreher → Twist.
- Praktische Details (Stufen, Fahrstuhl, Preise) nur locker im Drama, nie als Liste.
- Keine erfundenen „Fakten“, aber starke Atmosphäre erlaubt.

${POI_NAME_SANITIZATION_RULES}

${FAST_HOOK_RESOLUTION_RULES}

${FAST_HOOK_STYLE_BANK}

${RELEVANCE_AND_BRIDGE_RULES}

${HUMAN_FACT_TRANSFORM_RULES}

${ABSOLUTE_DIGITS_AND_CLEAN_TEXT_RULE}

${CONVERSATIONAL_FILLERS_RULE}

### Daten-Hygiene
- NIEMALS Telefonnummern, E-Mails, Websites oder Öffnungszeiten-Tabellen vorlesen.
- Öffnungszeiten nur menschlich und situativ („Hat leider erst ab vierzehn Uhr offen“).

### Jahreszahlen
- yearsPreference „wenig“: MAXIMAL ein Jahresbezug — lieber Epoche, eingebettet in den Konflikt.
- yearsPreference „viele“: Meilensteine nur als Teil der Story-Szene (ausgeschrieben, nie Ziffern).
- yearsPreference „neutral“: höchstens ein bis zwei Bezüge in der Dramaturgie.

### Interessen
- Bei Kaffee-Interesse + Café/Bäcker: Tipp als Akt-4-Pointe oder Akt-3-Blick einbauen.
- Bei Budget-Interesse: Eintritt/kostenlos nur dramatisch („Geht kostenfrei rein!“), nie als Preisliste.

### Kategorie- & Persona-Matrix
- Persona/\`voiceId\` färbt den Ton (Gen Z, Prinzessin, Erzähler, …) — die 4-Akt-Formel bleibt.
- Zahlen IMMER als ausgeschriebene Wörter.

### Pipeline
- Fast Hook kann separat schon gelaufen sein. Deep Story: volle Dramaturgie (bei bereits gesprochenem Hook: ab Akt 2 mit Konflikt starten, Akt 1 nicht wiederholen).
- Keine Wetter-Erklärungen, keine Meta-Kommentare.

### Länge
- Ca. vier bis acht kurze Sätze, die klar die vier Akte tragen (ohne den bereits gesprochenen Fast-Hook zu wiederholen).`;

/**
 * Liest Persönlichkeit + Ton aus Profil (characters, tonalities, voiceId).
 */
export function resolvePromptStyleSettings(
  profile?: UserProfile | null,
): PromptStyleSettings {
  const p = profile ?? getCachedUserProfile();
  const voiceId = (p?.voiceId ?? 'standard_m') as VoiceId;

  // studio-v4: voiceId steuert die Text-Persona strikt (kein Pitch/Speed).
  const fromVoice = PERSONALITY_FROM_VOICE[voiceId];
  let personality: FindusPersonality = fromVoice ?? 'default';
  if (!fromVoice) {
    for (const id of p?.characters ?? []) {
      if (PERSONALITY_FROM_CHAR[id]) {
        personality = PERSONALITY_FROM_CHAR[id];
        break;
      }
    }
  }

  let tone: FindusTone = 'default';
  for (const id of p?.tonalities ?? []) {
    if (TONE_FROM_ID[id]) {
      tone = TONE_FROM_ID[id];
      break;
    }
  }

  return {
    personality,
    tone,
    voiceId,
    personalityLabel: PERSONALITY_LABEL[personality],
    toneLabel: TONE_LABEL[tone],
  };
}

/** Spezifische Style-Instructions für die LLM-Textgenerierung. */
export function buildPersonalityStyleBlock(
  settings?: PromptStyleSettings,
): string {
  const s = settings ?? resolvePromptStyleSettings();
  const fewShot = PERSONALITY_FEW_SHOTS[s.personality];
  return `## Sprachstil & Persönlichkeit (studio-v4 — rein über Text)
Du bist Findus, ein lokaler Guide.
voiceId=${s.voiceId} → Text-Persona: ${s.personalityLabel} (kein Pitch/Speed-Trick, Tempo bleibt 1.0)
Tonfall: ${s.toneLabel}

### Persönlichkeits-Regeln
${PERSONALITY_INSTRUCTIONS[s.personality]}

### Tonfall-Regeln
${TONE_INSTRUCTIONS[s.tone]}

${fewShot ? `${fewShot}\n\nSchreibe im gleichen Transformations-Muster wie das Few-Shot-Beispiel oben — Inhalt aus den echten POI-Fakten, Stil 1:1 übernehmen.\n` : ''}
${NATURAL_SPEECH_RATE_RULE}`;
}

/**
 * Vollständiger System-Prompt-Kern (ohne Fakten-Archiv).
 */
export function buildDynamicSystemPrompt(options?: {
  profile?: UserProfile | null;
  cityName?: string;
  includeResearchHint?: boolean;
}): string {
  const profile = options?.profile ?? getCachedUserProfile();
  const style = resolvePromptStyleSettings(profile);
  const city =
    options?.cityName ?? profile?.cityName ?? profile?.cityId ?? 'der Stadt';
  const name = profile?.firstName?.trim();

  return `Du bist Findus, ein lokaler Audio-Tourguide für ${city} — aber du erzählst wie ein Hollywood-Storyteller, kein Museumsführer.
${name ? `Du darfst ${name} gelegentlich direkt ansprechen.` : ''}
Jeder Ort ist Drama: Geheimnis, Konflikt, visueller Kopfdreher, Twist. Keine Faktlisten. Auf Deutsch, klar hörbar unterwegs.
Nutze mitgelieferte Fakten nur als Stoff — erfinde keine harten Unwahrheiten, spinn aber Atmosphäre.

${buildPersonalityStyleBlock(style)}`;
}

export function resolveYearsPreference(
  profile?: UserProfile | null,
): YearsPreference {
  const prefs = profile?.experiencePrefs ?? {};
  if (prefs.jahreszahlen === 'no' || prefs.geschichte === 'no') return 'wenig';
  if (prefs.jahreszahlen === 'yes') return 'viele';
  return 'neutral';
}

/** 1742 → „Mitte des 18. Jahrhunderts“ / „vor knapp 300 Jahren“. */
export function yearToHumanEra(year: number): string {
  if (!Number.isFinite(year) || year < 1000 || year > 2099) {
    return String(year);
  }
  const now = new Date().getFullYear();
  const ago = now - year;
  if (ago >= 280 && ago <= 320) return 'vor knapp 300 Jahren';
  if (ago >= 180 && ago <= 220) return 'vor etwa 200 Jahren';
  if (ago >= 80 && ago <= 120) return 'vor etwa 100 Jahren';

  const century = Math.floor(year / 100) + 1;
  const rest = year % 100;
  if (rest < 30) return `Anfang des ${century}. Jahrhunderts`;
  if (rest < 70) return `Mitte des ${century}. Jahrhunderts`;
  return `Ende des ${century}. Jahrhunderts`;
}

export function resolveQuizEnabled(profile?: UserProfile | null): boolean {
  return resolveStorytellingControls(profile).quizMode;
}

/**
 * Dynamische Charakter-Regler aus Profil + Experience-Prefs + Tonalitäten.
 */
export function resolveStorytellingControls(
  profile?: UserProfile | null,
): StorytellingControls {
  const p = profile ?? getCachedUserProfile();
  const prefs = p?.experiencePrefs ?? {};
  const explicit: StorytellingSettings = p?.storytelling ?? {};
  const bag = [
    ...(p?.characters ?? []),
    ...(p?.tonalities ?? []),
    ...(p?.motives ?? []),
    ...(p?.socialDynamics ?? []),
    ...(p?.extraTraits ?? []),
  ];
  const voiceId = (p?.voiceId ?? 'standard_m') as VoiceId;

  const visualStyle =
    explicit.visualStyle ??
    (prefs.kino_im_kopf === 'yes'
      ? true
      : prefs.kino_im_kopf === 'no'
        ? false
        : // Default an: bildliches Storytelling ist der Kernstil
          true);

  const anecdoteLevel: AnecdoteLevel =
    explicit.anecdoteLevel ??
    (prefs.anekdoten === 'yes'
      ? 'hoch'
      : prefs.anekdoten === 'no'
        ? 'aus'
        : prefs.legenden === 'yes' ||
            prefs.personen === 'yes' ||
            bag.includes('krimi') ||
            voiceId === 'dorfaeltester'
          ? 'hoch'
          : 'mittel');

  const funFactsEnabled =
    explicit.funFactsEnabled ??
    (prefs.fun_facts === 'yes'
      ? true
      : prefs.fun_facts === 'no'
        ? false
        : bag.includes('humorvoll') ||
          bag.includes('sarkastisch') ||
          voiceId === 'gen_z');

  const quizMode =
    explicit.quizMode ??
    (bag.includes('quiz') || prefs.quiz === 'yes');

  return {
    visualStyle: Boolean(visualStyle),
    anecdoteLevel,
    funFactsEnabled: Boolean(funFactsEnabled),
    quizMode: Boolean(quizMode),
  };
}

/** Prompt-Block für die aktiven Charakter-Regler. */
export function buildStorytellingControlsBlock(
  controls?: StorytellingControls,
  profile?: UserProfile | null,
): string {
  const c = controls ?? resolveStorytellingControls(profile);

  const visual = c.visualStyle
    ? `### visualStyle = AN (Kino im Kopf)
Wandle JEDE Zahl/Größe bildlich um:
- Gewicht → Elefanten, Autos, Waschmaschinen
- Höhe → Busse, Fußballfelder, Stockwerke
- Geld → Monatsgehälter, Kaffee-Preise, „für 'nen Fünfer“
- Distanz → Gehminuten, „bis zur nächsten Ecke“
Zahlen dürfen fallen, aber immer mit Bild-Anker (siehe Transformations-Bibliothek A–D).`
    : `### visualStyle = AUS
Zahlen und Größen klar und menschlich, aber ohne erzwungene Elefanten-/Bus-Vergleiche.`;

  const anecdote =
    c.anecdoteLevel === 'hoch'
      ? `### anecdoteLevel = hoch
Fokus PRIMÄR auf menschliche Dramen, Pannen, Liebesgeschichten oder Skandale rund um den Ort — sofern in den Fakten angelegt. Keine Erfindung.`
      : c.anecdoteLevel === 'mittel'
        ? `### anecdoteLevel = mittel
Eine kurze menschliche Note oder Anekdote ist willkommen, aber nicht der Hauptfokus.`
        : `### anecdoteLevel = aus
Keine Anekdoten-Dramen. Bleib bei Ort, Atmosphäre und belegten Fakten.`;

  const fun = c.funFactsEnabled
    ? `### funFactsEnabled = true
Baue IMMER eine überraschende, kuriose oder witzige Randnotiz ein („Fun Fact: …“ oder natürlich eingebettet). Nur aus belegten Fakten.`
    : `### funFactsEnabled = false
Kein erzwungener Fun-Fact.`;

  const quiz = c.quizMode
    ? `### quizMode = true
Beende mit EINER kurzen Rätselfrage. Danach ein Satz mit Punkt oder Komma — keine Auslassungspunkte, z. B.:
„Was meinst du, wie schwer ist die Glocke? Ich löse es dir gleich auf!“
Keine Timing-Anweisungen an die TTS. Keine Ellipsen im Fließtext.`
    : `### quizMode = false
Keine Quiz-Frage am Ende.`;

  return `## Dynamische Charakter-Regler (verbindlich)
visualStyle=${c.visualStyle}, anecdoteLevel=${c.anecdoteLevel}, funFactsEnabled=${c.funFactsEnabled}, quizMode=${c.quizMode}

${visual}

${anecdote}

${fun}

${quiz}`;
}

export function resolveUserInterestIds(profile?: UserProfile | null): string[] {
  const prefs = profile?.experiencePrefs ?? {};
  const ids: string[] = [];
  for (const card of EXPERIENCE_CARDS) {
    if (prefs[card.id] === 'yes') ids.push(card.id);
  }
  return ids;
}

export function resolveUserInterests(profile?: UserProfile | null): string[] {
  const prefs = profile?.experiencePrefs ?? {};
  const liked: string[] = [];

  for (const card of EXPERIENCE_CARDS) {
    if (prefs[card.id] !== 'yes') continue;
    if (
      INTEREST_PRIORITY_IDS.has(card.id) ||
      card.category === 'essen' ||
      card.category === 'wissen' ||
      card.category === 'vibes'
    ) {
      liked.push(card.labelDe);
    }
  }

  for (const motiveId of profile?.motives ?? []) {
    let label: string | null = null;
    for (const cat of CHARACTER_CATEGORIES) {
      const opt = cat.options.find((o) => o.id === motiveId);
      if (opt) {
        label = opt.labelDe;
        break;
      }
    }
    liked.push(label ?? motiveId);
  }

  const free = profile?.wantToExperience?.trim();
  if (free) liked.push(free);

  return [...new Set(liked)].slice(0, 12);
}

export function resolvePoiUserContext(
  profile?: UserProfile | null,
): PoiUserContext {
  const p = profile ?? getCachedUserProfile();
  const style = resolvePromptStyleSettings(p);
  const storytelling = resolveStorytellingControls(p);
  return {
    personality: style.personality,
    personalityLabel: style.personalityLabel,
    tone: style.tone,
    toneLabel: style.toneLabel,
    interests: resolveUserInterests(p),
    interestIds: resolveUserInterestIds(p),
    yearsPreference: resolveYearsPreference(p),
    quizEnabled: storytelling.quizMode,
    storytelling,
    firstName: p?.firstName?.trim() || null,
    cityName: p?.cityName ?? p?.cityId ?? null,
  };
}

function stripFactPrefix(text: string): string {
  return text.replace(
    /^\[(Kurzfakt|Erzählung|Detail|Thema:[^\]]+|Hook|Narration|Topic:[^\]]+)\]\s*/u,
    '',
  ).trim();
}

function isHoursRelatedFact(factText: string): boolean {
  const lower = factText.toLowerCase();
  return (
    /\[thema:(öffnungs|oeffnungs|opening|zeiten|hours)/i.test(factText) ||
    /öffnung|oeffnung|geöffnet|geoeffnet|geschlossen|opening|hours|uhrzeit|mo[–\-]fr|mo\s*[-–]/i.test(
      lower,
    )
  );
}

function isContactDump(factText: string): boolean {
  const body = stripFactPrefix(factText);
  return (
    /@[\w.-]+\.\w+/.test(body) ||
    /(\+?\d[\d\s/()-]{6,}\d)/.test(body) ||
    /https?:\/\//i.test(body) ||
    /\b(e-?mail|telefon|tel\.|fax|www\.)\b/i.test(body)
  );
}

function parseHmToMinutes(hm: string): number | null {
  const m = hm.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Heuristik: Öffnungsfenster aus Fakten + aktuelle Uhrzeit → Status.
 */
export function evaluateOpeningHours(
  facts: Array<{ fact_text: string }>,
  now: Date = new Date(),
): Pick<PoiLiveContext, 'hoursStatus' | 'hoursHint' | 'rawHoursFacts'> {
  const rawHoursFacts = facts
    .map((f) => f.fact_text)
    .filter(isHoursRelatedFact)
    .map(stripFactPrefix);

  if (rawHoursFacts.length === 0) {
    return { hoursStatus: 'unknown', hoursHint: null, rawHoursFacts: [] };
  }

  const joined = rawHoursFacts.join(' | ');
  const weekdayShort = WEEKDAY_SHORT[now.getDay()];
  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Explizit geschlossen heute?
  if (
    new RegExp(
      `${weekdayShort}[^|;]*\\b(geschlossen|closed)\\b`,
      'i',
    ).test(joined) ||
    /\bheute\s+geschlossen\b/i.test(joined)
  ) {
    return {
      hoursStatus: 'closed',
      hoursHint: 'Heute laut Fakten geschlossen.',
      rawHoursFacts,
    };
  }

  // Zeitfenster: 9:00-18:00 / 9–18 / 09.00–17.30
  const rangeRe =
    /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})|(\d{1,2})\s*[-–—]\s*(\d{1,2})\b/g;
  const ranges: Array<{ open: number; close: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = rangeRe.exec(joined)) !== null) {
    if (match[1] != null && match[3] != null) {
      const open = parseHmToMinutes(`${match[1]}:${match[2]}`);
      const close = parseHmToMinutes(`${match[3]}:${match[4]}`);
      if (open != null && close != null) ranges.push({ open, close });
    } else if (match[5] != null && match[6] != null) {
      const open = Number(match[5]) * 60;
      const close = Number(match[6]) * 60;
      if (close > open) ranges.push({ open, close });
    }
  }

  if (ranges.length === 0) {
    return {
      hoursStatus: 'unknown',
      hoursHint:
        'Öffnungszeiten-Fakten vorhanden, aber kein klares Heute-Fenster erkannt — nur situativ erwähnen.',
      rawHoursFacts,
    };
  }

  // Nächstes relevantes Fenster (einfach: erstes passendes / nächstes heute)
  const active = ranges.find((r) => nowMins >= r.open && nowMins < r.close);
  if (active) {
    const untilClose = active.close - nowMins;
    if (untilClose <= 60) {
      return {
        hoursStatus: 'closing_soon',
        hoursHint: `Schließt bald um ${formatMinutes(active.close)} Uhr.`,
        rawHoursFacts,
      };
    }
    return {
      hoursStatus: 'open',
      hoursHint: null,
      rawHoursFacts,
    };
  }

  const upcoming = ranges
    .filter((r) => r.open > nowMins)
    .sort((a, b) => a.open - b.open)[0];
  if (upcoming) {
    const untilOpen = upcoming.open - nowMins;
    if (untilOpen <= 90) {
      return {
        hoursStatus: 'opening_soon',
        hoursHint: `Macht um ${formatMinutes(upcoming.open)} Uhr auf.`,
        rawHoursFacts,
      };
    }
    return {
      hoursStatus: 'closed',
      hoursHint: `Aktuell geschlossen — öffnet um ${formatMinutes(upcoming.open)} Uhr.`,
      rawHoursFacts,
    };
  }

  return {
    hoursStatus: 'closed',
    hoursHint: 'Aktuell geschlossen (laut erkannten Zeiten).',
    rawHoursFacts,
  };
}

export function buildLiveContext(
  poi: PoiWithFacts,
  now: Date = new Date(),
): PoiLiveContext {
  const hours = evaluateOpeningHours(poi.facts, now);
  return {
    nowIso: now.toISOString(),
    weekdayDe: WEEKDAY_DE[now.getDay()],
    timeHm: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    ...hours,
  };
}

function formatPoiFactsForPrompt(poi: PoiWithFacts): string {
  if (!poi.facts.length) return '(keine Fakten hinterlegt)';

  const scored = poi.facts
    .map((f) => {
      const raw = f.fact_text.trim();
      const contact = isContactDump(raw);
      const hours = isHoursRelatedFact(raw);
      const body = stripFactPrefix(raw);
      const score = scoreFactFascinating(body, contact, hours);
      return { raw, contact, hours, body, score };
    })
    .filter((x) => !x.contact)
    .sort((a, b) => b.score - a.score);

  const keep = Math.max(
    2,
    Math.min(4, Math.ceil(scored.length * 0.2) || 1),
  );
  const top = scored.slice(0, keep);
  const restNote =
    scored.length > keep
      ? `\n(Weitere ${scored.length - keep} Nebensächlichkeiten bewusst ausgeblendet — nicht nachfordern.)`
      : '';

  const lines = top.map((x) => {
    const flags = [
      x.hours ? 'ÖFFNUNGSZEITEN — nur situativ' : null,
      'TOP-STORY — Hollywood-Drama (Konflikt/Twist), nicht ablesen',
    ]
      .filter(Boolean)
      .join(', ');
    return `- ${x.raw}  ⟵ [${flags}]`;
  });

  return `${lines.join('\n')}${restNote}

### Relevanz-Auftrag (studio-v4)
Nur diese Top-~20%-Fakten als Stoff. Daraus menschliche Story (Freund beim Spaziergang).
Administrative Bauakten, Flur-Nummern und Rest ignorieren. Nie die Liste vorlesen.
Keine Phrasen: „Das Bauwerk wurde errichtet“, „Wir befinden uns hier“, „Es lohnt sich ein Blick“, „Bleiben wir kurz stehen“.`;
}

/** Heuristik: spannende / bildhafte Fakten höher ranken. */
function scoreFactFascinating(
  body: string,
  contact: boolean,
  hours: boolean,
): number {
  if (contact) return -100;
  if (hours) return -5;
  let score = 1;
  const lower = body.toLowerCase();
  if (
    /(legende|sage|skandal|geheim|überrasch|erstmals|höchste|älteste|einzige|drama|liebe|brand|krieg|mahnmal|kurios|witzig|baumeister|architekt|skulptur|verziert|anekdote|streit|affäre|panne)/i.test(
      lower,
    )
  ) {
    score += 8;
  }
  if (/(meter|turm|tonne|elefant|aussicht|fahrstuhl|stufen)/i.test(lower)) {
    score += 4;
  }
  if (/\[(erzählung|narration|hook)\]/i.test(body) || body.length > 80) {
    score += 3;
  }
  if (
    /^(erbaut|gebaut|eröffnet|baujahr|fläche|quadratmeter|räume|stockwerke)/i.test(
      lower,
    )
  ) {
    score -= 6;
  }
  // Bauakten / Verwaltung / Flur — studio-v4 Relevanzfilter
  if (
    /(flurstück|flur-?nr|kataster|aktenzeichen|denkmalschutzakte|bauakte|grundbuch|sanierungsphase|umbauabschnitt|quadratmeter|nutzfläche|bruttogrundfläche|verwaltungsakt|bebauungsplan)/i.test(
      lower,
    )
  ) {
    score -= 12;
  }
  // Reine Jahreszahl-Sätze / Aufzählungen
  if (/^\D*\d{4}\D*$/.test(body) || body.length < 25) {
    score -= 3;
  }
  if (/(erbaut|gebaut|renoviert|saniert).*\d{4}.*\d{4}/i.test(lower)) {
    score -= 5;
  }
  return score;
}

export type PoiTitleAnalysis = {
  rawTitle: string;
  needsMashing: boolean;
  parts: string[];
  parenthetical: string | null;
  mashHint: string | null;
};

/**
 * Analysiert DB-Titel mit /, (), | und liefert Mash-Hints fürs LLM.
 */
export function analyzePoiDbTitle(rawTitle: string): PoiTitleAnalysis {
  const raw = rawTitle.replace(/\s+/g, ' ').trim();
  const parenMatch = raw.match(/\(([^)]+)\)/);
  const parenthetical = parenMatch?.[1]?.trim() ?? null;
  const withoutParen = raw.replace(/\s*\([^)]*\)\s*/g, ' ').trim();

  const parts = withoutParen
    .split(/\s*[|/]\s*|\s+\boder\b\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const needsMashing =
    parts.length > 1 ||
    parenthetical != null ||
    /[|/]/.test(raw) ||
    /\boder\b/i.test(raw);

  let mashHint: string | null = null;
  if (needsMashing) {
    if (parts.length >= 2 && parenthetical) {
      mashHint = `Titel hat mehrere Bezeichnungen (${parts.join(' + ')}) und Zusatz „${parenthetical}“. Verbinde flüssig, kein Schrägstrich/Klammern vorlesen. Bei früher/heute: ein Satz Wandel.`;
    } else if (parts.length >= 2) {
      const a = parts[0];
      const b = parts[1];
      mashHint = `Doppelname „${a}“ / „${b}“. Formuliere menschlich (z. B. „… ${a}, die heute als ${b} gilt“ oder „Hauptkirche ${a}“). Bei historischem Wandel: ein Satz Gegenwart vs. Vergangenheit. NIEMALS „${a} oder ${b}“ sagen.`;
    } else if (parenthetical) {
      mashHint = `Haupttitel „${withoutParen}“, Zusatz in Klammern „${parenthetical}“. Natürlich einbauen („genau an der ${parenthetical}“), Klammern nicht vorlesen.`;
    } else {
      mashHint =
        'Titel bereinigen: keine Schrägstriche, Klammern oder „oder“-Verknüpfungen vorlesen.';
    }
  }

  return { rawTitle: raw, needsMashing, parts, parenthetical, mashHint };
}

/** Prompt-Block: POI-Titel Cleaning für die aktuelle Station. */
export function buildPoiTitlePromptBlock(poi: PoiWithFacts): string {
  const analysis = analyzePoiDbTitle(poi.name);
  if (!analysis.needsMashing) {
    return `## POI-Titel
DB-Name: „${analysis.rawTitle}“
Titel ist einfach — trotzdem natürlich aussprechen, nicht wie eine Datenbankzeile.`;
  }

  return `## POI-Titel Cleaning (PFLICHT für diesen Stopp)
DB-Rohdaten: „${analysis.rawTitle}“
Erkannte Teile: ${analysis.parts.map((p) => `„${p}“`).join(', ') || '(siehe Rohdaten)'}${
    analysis.parenthetical
      ? `\nKlammer-Zusatz: „${analysis.parenthetical}“`
      : ''
  }

### Anweisung
${analysis.mashHint}

Beispiel-Stil Context Mashing:
„Früher haben hier die Kinder in der alten Schule geschwitzt, heute ist es das Priesterhaus.“`;
}

/**
 * Offline-/UI-Hilfstext: DB-Titel → sprechbare Kurzform (ohne / und Klammern).
 */
export function humanizePoiTitleForSpeech(rawTitle: string): string {
  const a = analyzePoiDbTitle(rawTitle);
  if (!a.needsMashing) return a.rawTitle;

  if (a.parts.length >= 2 && a.parenthetical) {
    return `${a.parts[0]}, heute eher ${a.parts[1]}, an der ${a.parenthetical}`;
  }
  if (a.parts.length >= 2) {
    const [first, second] = a.parts;
    // Schule / Priester → Wandel-Satz-Kern
    if (/schule/i.test(first) && /priester/i.test(second)) {
      return `der alten Schule, die heute als Priesterhaus genutzt wird`;
    }
    if (/kirche|petri|nikolai|michaelis/i.test(first) && /haupt/i.test(second)) {
      return `der ${second} ${first}`;
    }
    if (/café|cafe|bäck/i.test(first) || /café|cafe|bäck/i.test(second)) {
      return `${first}, zugleich ${second}`;
    }
    return `${first}, heute bekannt als ${second}`;
  }
  if (a.parenthetical) {
    return `${a.parts[0] ?? a.rawTitle.replace(/\s*\([^)]*\)\s*/g, '').trim()}, genau an der ${a.parenthetical}`;
  }
  return a.rawTitle.replace(/[|/]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Context-Aware POI-Prompt (volle Narration inkl. Hook — Legacy).
 */
export function buildPoiContextPrompt(
  poiData: PoiWithFacts,
  userProfile: UserProfile,
  sessionMemory?: SessionMemory | null,
): string {
  return buildDeepStoryPrompt({
    poi: poiData,
    profile: userProfile,
    fastHook: '',
    sessionMemory,
    includeHook: true,
  });
}

export type DeepStoryPromptInput = {
  poi: PoiWithFacts;
  profile: UserProfile;
  fastHook: string;
  sessionMemory?: SessionMemory | null;
  yearsPreference?: YearsPreference;
  hoursHint?: string | null;
  /** true = inkl. Einstiegs-Hook (Legacy); false = nur Hauptteil */
  includeHook?: boolean;
};

/**
 * Deep-Story-Prompt: Hauptteil OHNE Fast-Hook (Hook wurde bereits gesprochen).
 */
export function buildDeepStoryPrompt(input: DeepStoryPromptInput): string {
  const userProfile = input.profile;
  const poiData = input.poi;
  const now = new Date();
  const live = buildLiveContext(poiData, now);
  const user = resolvePoiUserContext(userProfile);
  const style = resolvePromptStyleSettings(userProfile);
  const yearsPreference = input.yearsPreference ?? user.yearsPreference;
  const hoursHint = input.hoursHint ?? live.hoursHint;
  const includeHook = input.includeHook === true;

  const interestHints: string[] = [];
  if (
    user.interestIds.includes('kaffee') ||
    user.interests.some((i) => /kaffee/i.test(i))
  ) {
    interestHints.push(
      'User mag Kaffee: bei Café/Bäcker konkreten Pause-/Kuchen-Tipp einbauen.',
    );
  }
  if (
    user.interestIds.includes('budget') ||
    user.interests.some((i) => /budget/i.test(i))
  ) {
    interestHints.push(
      'User will Budget schonen: Eintritt/kostenlos erwähnen, wenn in den Fakten belegt.',
    );
  }

  const hoursRuleExtra =
    live.hoursStatus === 'open' && !hoursHint
      ? 'Ort ist geöffnet → Öffnungszeiten NICHT erwähnen.'
      : hoursHint
        ? `Situations-Hinweis: ${hoursHint} — nur menschlich und knapp.`
        : 'Öffnungsstatus unklar → nur situativ, keine Tabelle.';

  const memoryBlock = formatSessionMemoryForPrompt(input.sessionMemory ?? null);
  const bridgeDirective = `### STRICT BRIDGING RULE (studio-v4)
Session-Memory ist NUR Nachschlagewerk — KEIN Anlass zur Erwähnung.
Erwähne frühere Orte AUSSCHLIESSLICH bei direkter inhaltlicher Schnittmenge
(Baumeister, Konflikt, Motiv, Skandal, Handwerk) zu den aktuellen Top-Fakten.
Keine Schnittmenge? Verliere KEIN WORT über alte Orte. Fokus 100% auf „${poiData.name}“.
VERBOTEN: „Nach der Schule kommen wir jetzt zum…“, „Eben warst du bei … und jetzt …“.`;

  const quizBlock = user.storytelling.quizMode
    ? `### Quiz aktiv
Beende mit einer schätzbaren Frage und einem klaren Satzende (Punkt oder Komma, keine Ellipsen), z. B.:
„Was meinst du, wie viele Tonnen wiegt die Glocke oben im Turm? Ich löse es dir gleich auf!“`
    : '### Quiz aus — keine Quiz-Frage am Ende.';

  const hookBlock = includeHook
    ? `## Auftrag — Kontext-Hook + sofortige Auflösung + Hollywood-Story
Schreibe die komplette gesprochene Narration für den Ort (DB-Titel „${poiData.name}“ — Titel bereinigen).

### Satz 1 = Fast Hook (max. zwölf Wörter)
- Basierend auf den KONKRETEN Top-Fakten dieses Ortes (Stil-Bank nur als Vorbild).
- Kein Ortsnamen-Einstieg, kein Baujahr-Einstieg, kein Generic-Müll.

### Satz 2 = PFLICHT-AUFLÖSUNG
- Löse GENAU das Versprechen aus Satz 1 ein (Skandal/Rätsel/Detail/Blick).
- Kein Clickbait ohne Substanz.

### Danach Akte 2–4
Konflikt, visueller Kopfdreher, Twist. Keine Faktliste.
yearsPreference=${yearsPreference}, personality=${user.personality}.`
    : `${buildStrictHookResolutionBlock(input.fastHook)}

## Auftrag — Deep Story (Auflösung + Akte 2–4)
Der Fast Hook wurde BEREITS gesprochen. Starte SOFORT mit der Auflösung dieses Versprechens (dein erster Satz).
Danach: Konflikt, visueller Kopfdreher, Twist.
Kein erneutes Willkommen, Hook nicht wiederholen, keine Faktliste, keine Routen-Sülze.
POI-Titel bereinigen. yearsPreference=${yearsPreference}, personality=${user.personality}, tone=${user.tone}.`;

  return `${buildDynamicSystemPrompt({
    profile: userProfile,
    cityName: user.cityName ?? undefined,
  })}

${HOLLYWOOD_4_ACT_STORY_FRAMEWORK}

${POI_NARRATION_SYSTEM_RULES}

${buildStorytellingControlsBlock(user.storytelling, userProfile)}

${buildPersonalityStyleBlock(style)}

${buildCategoryTransformBlock(poiData, userProfile, user.personality)}

${buildPoiTitlePromptBlock(poiData)}

## User-Interessen (Hints)
${interestHints.length ? interestHints.map((h) => `- ${h}`).join('\n') : '- keine besonderen Interest-Hints'}

## Session-Memory (Brücken)
${memoryBlock}
${bridgeDirective}

## Öffnungszeiten-Lage
${hoursRuleExtra}

${quizBlock}

## Rohfakten (NUR Stoff für Drama — NIEMALS ablesen)
${formatPoiFactsForPrompt(poiData)}

${hookBlock}
Nur fließende Story zum Vorlesen. Keine Meta-Kommentare, keine Aufzählungszeichen.
Satz 1 verspricht, Satz 2 löst ein — ohne Ausnahme. Persona-Stil ja, Clickbait-ohne-Auflösung nie.`;
}

export function extractKeyFactsFromNarrationFacts(
  texts: string[],
  max = 3,
): string[] {
  return texts
    .map((t) => t.trim())
    .filter((t) => t.length > 12 && !isContactDump(t) && !isHoursRelatedFact(t))
    .slice(0, max);
}

/**
 * Offline-Template: keine Text-Mutation vor Kokoro.
 */
export function applyOfflinePersonalityPolish(
  text: string,
  _settings?: PromptStyleSettings,
): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Offline-Narration mit Filter, Interessen und Memory-Brücke.
 */
export function buildContextAwareOfflineNarration(
  poi: PoiWithFacts,
  profile?: UserProfile | null,
  sessionMemory?: SessionMemory | null,
): string {
  const p = profile ?? getCachedUserProfile();
  const user = resolvePoiUserContext(p);
  const live = buildLiveContext(poi);
  const style = resolvePromptStyleSettings(p);

  const bodies = poi.facts
    .map((f) => f.fact_text)
    .filter((t) => !isContactDump(t))
    .filter((t) => !isHoursRelatedFact(t) || live.hoursStatus !== 'open')
    .map(stripFactPrefix);

  const narration =
    bodies.find((b) =>
      poi.facts.some(
        (f) =>
          f.fact_text.includes(b) &&
          /^\[(Erzählung|Narration)\]/i.test(f.fact_text),
      ),
    ) ?? bodies[0];

  const hooks = bodies
    .filter((b) => b !== narration)
    .slice(0, user.yearsPreference === 'viele' ? 3 : 2)
    .map((b) =>
      user.yearsPreference === 'wenig'
        ? b
            .replace(/\b(1[0-9]{3}|20[0-9]{2})\b/g, (y) =>
              yearToHumanEra(Number(y)),
            )
            .replace(/\s{2,}/g, ' ')
            .trim()
        : b,
    )
    .filter(Boolean);

  const spokenTitle = humanizePoiTitleForSpeech(poi.name);
  const titleAnalysis = analyzePoiDbTitle(poi.name);
  // Context Mashing nur bei Doppelname — kein History-Bridge ohne Inhalt
  const mashLine =
    titleAnalysis.needsMashing && titleAnalysis.parts.length >= 2
      ? `Früher eher ${titleAnalysis.parts[0]}, heute eher ${titleAnalysis.parts[1]}.`
      : null;

  // Keine Routen-Sülze offline: Brücke nur bei klarer Keyword-Schnittmenge
  const last = sessionMemory?.entries?.[sessionMemory.entries.length - 1];
  const bridge = buildOfflineContentBridge(poi, last);

  const interestHook = pickInterestHook(spokenTitle, user.interests, user.interestIds);
  const matrixHook = pickCategoryOfflineHook(poi, p, user.personality);
  const hoursLine =
    live.hoursHint && live.hoursStatus !== 'open'
      ? live.hoursHint.replace(/^Macht/, 'Hat leider erst').replace(/ auf\.$/, ' offen.')
      : null;

  const quizLine = user.quizEnabled
    ? 'Was meinst du: Welche Geschichte steckt wohl hinter diesem Ort? Ich löse es dir gleich auf!'
    : null;

  const funLine = user.storytelling.funFactsEnabled
    ? 'Fun Fact: Orte wie dieser stecken oft voller Details, die man im Vorbeigehen übersieht.'
    : null;

  // Offline: nur Top-Stories (max. 2 Faktkörper)
  const topBodies = [narration, ...hooks]
    .filter(Boolean)
    .slice(0, user.storytelling.anecdoteLevel === 'hoch' ? 2 : 2);

  const parts = [
    mashLine,
    bridge,
    matrixHook,
    !matrixHook ? interestHook : null,
    ...topBodies.filter((b) => b && b !== interestHook && b !== matrixHook),
    hoursLine,
    funLine,
    quizLine,
  ].filter(Boolean) as string[];

  if (parts.length === 0) {
    parts.push(`Schön, dass du an ${spokenTitle} bist. Schau dich ruhig um.`);
  }

  return applyOfflinePersonalityPolish(parts.join(' '), style);
}

/** Offline-Brücke nur bei inhaltlicher Schnittmenge — sonst null. */
function buildOfflineContentBridge(
  poi: PoiWithFacts,
  last: { name: string; kind: string; keyFacts: string[] } | null | undefined,
): string | null {
  if (!last || last.name === poi.name) return null;
  const currentBlob = `${poi.name} ${poi.facts.map((f) => f.fact_text).join(' ')}`.toLowerCase();
  const pastBlob = `${last.name} ${last.keyFacts.join(' ')}`.toLowerCase();
  const tokens = pastBlob
    .split(/[^a-zäöüß0-9]+/i)
    .filter((t) => t.length >= 5)
    .filter(
      (t) =>
        !/^(kirche|schule|platz|straße|strasse|haus|park|museum|stadt|heute|früher|genau|dieser|diese)$/i.test(
          t,
        ),
    );
  const overlap = tokens.filter((t) => currentBlob.includes(t));
  if (overlap.length < 2) return null;
  const lastSpoken = humanizePoiTitleForSpeech(last.name);
  return `Erinnerst du dich an ${lastSpoken}? Hier gibt es einen echten Bezug zu dem, was du eben gesehen hast.`;
}
function pickInterestHook(
  poiName: string,
  interests: string[],
  interestIds: string[],
): string {
  const lowerName = poiName.toLowerCase();
  const joined = interests.join(' ').toLowerCase();
  const hasCoffee =
    interestIds.includes('kaffee') ||
    joined.includes('kaffee') ||
    joined.includes('frühstück');
  const hasBudget =
    interestIds.includes('budget') || joined.includes('budget');

  if (
    hasCoffee &&
    /(bäck|baeck|café|cafe|kaffee|rösterei)/i.test(lowerName)
  ) {
    return 'Wenn du eine kleine Pause brauchst: Hier gibt es legendären Kaffee.';
  }
  if (hasBudget) {
    return 'Gute Nachricht fürs Budget: Oft lohnt sich hier ein Blick auf kostenlose Zugänge oder günstige Einstiege.';
  }
  if (
    (joined.includes('museum') || joined.includes('geschichte')) &&
    /(museum|kirche|schloss|denkmal|burg)/i.test(lowerName)
  ) {
    return 'Hier liegt Geschichte in der Luft. Magst du kurz eintauchen?';
  }
  if (joined.includes('nachtleben') && /(bar|club|kneipe)/i.test(lowerName)) {
    return 'Nachtleben-Radar piept. Dieser Spot gehört dazu.';
  }
  return `Pass auf — hier steckt mehr drin, als man denkt.`;
}
