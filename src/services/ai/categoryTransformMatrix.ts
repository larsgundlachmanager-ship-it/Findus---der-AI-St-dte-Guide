/**
 * Multi-Category Location Matrix: DB-Rohdaten → persona-getreue Geschichten.
 * Wird von promptBuilder in den System-Prompt injiziert.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile, VoiceId } from '../../types/userProfile';

/** Orts-Kategorien der Transform-Matrix. */
export type LocationCategory =
  | 'cafe'
  | 'church'
  | 'water'
  | 'museum'
  | 'mall'
  | 'historic'
  | 'generic';

/** Personas der Matrix (= Kokoro VoiceIds + Rollen). */
export type MatrixPersona =
  | 'standard_m'
  | 'standard_w'
  | 'prinzessin'
  | 'erzaehler'
  | 'dorfaeltester'
  | 'historiker'
  | 'gen_z'
  | 'energisch';

export const MATRIX_PERSONAS: readonly MatrixPersona[] = [
  'standard_m',
  'standard_w',
  'prinzessin',
  'erzaehler',
  'dorfaeltester',
  'historiker',
  'gen_z',
  'energisch',
] as const;

export type CategoryMatrixEntry = {
  id: LocationCategory;
  labelDe: string;
  rawExample: string;
  transforms: Record<MatrixPersona, string>;
};

/** Vollständige Few-Shot-Bibliothek (5 Kern-Kategorien). */
export const CATEGORY_TRANSFORM_MATRIX: Record<
  'cafe' | 'church' | 'water' | 'museum' | 'mall',
  CategoryMatrixEntry
> = {
  cafe: {
    id: 'cafe',
    labelDe: 'Cafés / Restaurants / Gastronomie',
    rawExample:
      'Café Speicherstadt, gegründet 1928. Spezialität: Franzbrötchen & Röstkaffee. Preis: ca. 6,50€.',
    transforms: {
      standard_m:
        "Falls du eine kleine Pause brauchst: Das Café hier gibt's schon seit 1928. Schnapp dir ein frisches Franzbrötchen und 'nen Kaffee für gut sechs Euro – lohnt sich!",
      standard_w:
        'Riechst du auch schon diesen herrlichen Kaffeeduft? Das Café hier backt seit fast 100 Jahren fantastische Franzbrötchen. Perfekt für ein kurzes Durchatmen!',
      prinzessin:
        'Ein süßer Duft zieht durch die Luft, wie Schätze aus der Zaubergruft. Seit 1928 backt man hier mit Fleiß – komm, nasch ein Brötchen zum kleinen Preis!',
      erzaehler:
        'Atme ein. Seit fast einem Jahrhundert rösten die Meister an diesem Ort die edelsten Bohnen. Ein Zufluchtsort für müde Wanderer mitten in der Speicherstadt.',
      dorfaeltester:
        'Ach, das alte Speicherstadt-Café! Da hat mein Großvater 1928 schon seinen Kaffee getrunken. Die Franzbrötchen schmecken immer noch genau so gut wie damals.',
      historiker:
        'Dieses Etablissement geht auf das Jahr 1928 zurück und spiegelt die hanseatische Kaffeetradition wider. Ein authentisches Relikt der damaligen Konsumkultur.',
      gen_z:
        "Yo, riechst du das? Das Café hier ist seit 1928 am Start. Die Franzbrötchen sind absoluter Peak-Content – no cap, gönn dir mal 'ne Pause!",
      energisch:
        'Boah, riechst du diesen Röstkaffee?! Seit 1928 die Anlaufstelle Nummer eins! Schnapp dir sofort ein Franzbrötchen und weiter geht das Abenteuer!',
    },
  },
  church: {
    id: 'church',
    labelDe: 'Kirchen / Sakralbauten',
    rawExample:
      'St. Nikolai, Turmhöhe: 147m. Erbaut 1874, 1943 im Krieg zerstört. Mahnmal. Eintritt Aussichtsplattform: 6,00€.',
    transforms: {
      standard_m:
        'Schau mal ganz hoch zur Spitze. 147 Meter! Der Turm steht seit 1874, wurde im Krieg stark beschädigt und dient heute als Mahnmal. Für sechs Euro kannst du mit dem Fahrstuhl hochfahren.',
      standard_w:
        'Ein wirklich beeindruckender und berührender Ort. Der Turm ragt 147 Meter in den Himmel. Nach der Zerstörung im Krieg erinnert er uns heute an den Frieden. Der Ausblick von oben ist einmalig!',
      prinzessin:
        'Ein steinerner Riese, so hoch und so stolz, einst gebaut aus Ziegel und Holz. Der Krieg schlug Wunden, doch er steht noch hier – schau hoch zu den Wolken und lausche mit mir.',
      erzaehler:
        '147 Meter ragt diese düstere Silhouette in den Himmel. 1943 brannte hier die Hölle auf Erden. Was heute steht, ist kein gewöhnliches Bauwerk – es ist ein stummes Monument der Geschichte.',
      dorfaeltester:
        'Wenn ich vor diesen alten Mauern stehe, läuft es mir immer noch kalt den Rücken runter. 147 Meter hoch. Als junger Kerl habe ich den Wiederaufbau miterlebt.',
      historiker:
        'Die neugotische St.-Nikolai-Kirche war bei ihrer Fertigstellung 1874 kurzzeitig das höchste Gebäude der Welt. Die Kriegsruine fungiert heute als zentrales Mahnmal.',
      gen_z:
        'Bro, schau dir diesen gigantischen Turm an! 147 Meter hoch, früher mal das höchste Gebäude der Welt! 1943 leider im Krieg zerstört – aber von oben hast du den wildesten Ausblick überhaupt.',
      energisch:
        'Wahnsinn, was für ein Koloss! 147 Meter reine Geschichte! Fahr für sechs Euro hoch auf die Plattform – der Ausblick wird dich komplett wegblasen!',
    },
  },
  water: {
    id: 'water',
    labelDe: 'Gewässer / Flüsse / Seen / Schifffahrt',
    rawExample:
      'Landungsbrücken, St. Pauli. Baujahr 1909. Abfahrt HADAG-Fähren, Hafenrundfahrten ab 18,00€.',
    transforms: {
      standard_m:
        "Hier an den Landungsbrücken schlägt das Herz des Hafens. Seit 1909 legen hier die Schiffe an. Wenn du Bock auf 'ne Hafenrundfahrt hast: Geht ab 18 Euro los.",
      standard_w:
        'Das Plätschern des Wassers und das Nebelhorn der Schiffe. Herrlich! Seit 1909 ist das hier der Hauptknotenpunkt im Hafen. Schnapp dir eine Fähre und genieß die Brise!',
      prinzessin:
        'Wo das Wasser tanzt im Wellenschein, ziehen Schiffe in die Welt hinein. Seit 1909 legt man hier an – komm mit an Bord und staune dann!',
      erzaehler:
        'Spürst du den rauen Seewind? Seit 1909 stechen von diesen Holzstegen Auswanderer und Seebären in See. Hier beginnt die Reise auf die Weltmeere.',
      dorfaeltester:
        'Ach, die Landungsbrücken. Weißt du, wie viele Stunden ich hier früher als Kind saß und den großen Dampfern hinterhergeschaut habe? Das riecht heute noch genau wie damals nach Teer und Freiheit.',
      historiker:
        'Die 1909 errichtete Schwimmanleger-Konstruktion diente historisch der Abwicklung des Passagierverkehrs der Ozeandampfer. Heute ein zentraler touristischer Knotenpunkt.',
      gen_z:
        "Komm mal klar auf diesen Vibe hier am Wasser! Landungsbrücken seit 1909 am Start. Für 18 Tacken kannst du dir 'ne Hafenrundfahrt gönnen – absolute Empfehlung!",
      energisch:
        'Ahoi! Hier geht die Post ab! Schiffe, Wellen, Hafenflair! Such dir eine Fähre aus, wir stechen jetzt sofort in See!',
    },
  },
  museum: {
    id: 'museum',
    labelDe: 'Museen / Kultur',
    rawExample:
      'Internationales Maritimes Museum (Kaispeicher B). 10 Stockwerke, 50.000 Schiffsmodelle, ältestes Bauwerk der Speicherstadt (1879).',
    transforms: {
      standard_m:
        'Du stehst hier vor dem ältesten Speicher der Stadt von 1879. Drinnen warten zehn Stockwerke voller Schiffsgeschichte und über 50.000 Minischiffe – echt abgefahren!',
      standard_w:
        'Ein faszinierender Ort! Das Gebäude von 1879 beherbergt über zehn Etagen unzählige Geschichten der Seefahrt. Ein absolutes Highlight für Kulturfans!',
      prinzessin:
        'Zehn Reiche voller Abenteuerglanz, ein altes Schloss aus rotem Backsteintanz. Fünfzigtausend Schiffe träumen hier im Raum – tritt ein und lebe diesen Seemannstraum!',
      erzaehler:
        'Zehn Etagen. Fünfzigtausend Schiffe. In diesem mächtigen Speicher aus dem Jahre 1879 schlummern die Abenteuer und Tragödien von dreitausend Jahren Seefahrt.',
      dorfaeltester:
        'Dieses Backsteingebäude kenne ich noch als funktionierendes Lagerhaus! Dass daraus mal ein Museum mit 50.000 Schiffchen wird – wer hätte das damals gedacht?',
      historiker:
        'Der Kaispeicher B aus dem Jahr 1879 stellt das älteste erhaltene Bauwerk des Ensembles dar. Die Ausstellung umfasst maritim-historische Exponate von globalem Rang.',
      gen_z:
        'Digga, 10 Stockwerke vollgepackt mit über 50.000 Schiffen! Das Gebäude selbst ist von 1879 – richtiger Vintage-Traum drinnen!',
      energisch:
        'Zehn Stockwerke pure Entdeckungslust! 50.000 Schiffe warten auf dich! Ab nach drinnen, das musst du gesehen haben!',
    },
  },
  mall: {
    id: 'mall',
    labelDe: 'Einkaufsstraßen / Malls / Shops',
    rawExample:
      'Mönckebergstraße. Haupteinkaufsstraße Hamburgs. Angelegt 1909. Ca. 50.000 Passanten täglich.',
    transforms: {
      standard_m:
        "Hier auf der 'Mö' steppt der Bär! Seit 1909 ist das Hamburgs Haupteinkaufsstraße. Täglich schlendern hier rund 50.000 Leute durch die Geschäfte.",
      standard_w:
        'Lust auf ein bisschen Bimmeln und Bummeln? Die Mönckebergstraße lädt seit über 100 Jahren zum Shoppen ein. Hier ist immer was los!',
      prinzessin:
        'Ein Pfad voller Schätze, Geschäft an Geschäft, wo das Leben sich türmt und die Welt sich trifft. Seit 1909 schlendert man hier fein – komm, lass uns stöbern im Sonnenschein!',
      erzaehler:
        'Ein pulsierender Strom aus Menschen. Seit 1909 drängen sich hier fünfzigtausend Seelen täglich durch die prachtvollen Ladenzeilen dieser Metropole.',
      dorfaeltester:
        'Die Mö. Früher gab es hier noch Straßenbahnen mittendrin! Heute bummelt ganz Hamburg hier durch die Läden. Ein tolles Gewusel!',
      historiker:
        'Die 1909 als Prachtboulevard durchgebrochene Mönckebergstraße verbindet das Rathaus mit dem Hauptbahnhof und stellt die primäre Einzelhandelsachse dar.',
      gen_z:
        'Absoluter Shopping-Hotspot! Die Mö ist seit 1909 am Start. Täglich 50k Leute hier unterwegs – richtiger Trubel, aber geiler Vibe!',
      energisch:
        'Shoppen bis zum Umfallen! 50.000 Menschen täglich können nicht irren! Lass uns in die Geschäfte stürzen!',
    },
  },
};

const PERSONALITY_TO_MATRIX: Record<string, MatrixPersona> = {
  gen_z: 'gen_z',
  historiker: 'historiker',
  party: 'energisch',
  prinzessin: 'prinzessin',
  erzaehler: 'erzaehler',
  dorfaeltester: 'dorfaeltester',
  poet: 'prinzessin',
  fuersorglich: 'standard_w',
  reiseblogger: 'standard_w',
  lokalpatriot: 'dorfaeltester',
  default: 'standard_m',
};

/** VoiceId / Personality → Matrix-Persona. */
export function resolveMatrixPersona(
  profile?: UserProfile | null,
  personality?: string | null,
): MatrixPersona {
  const voiceId = (profile?.voiceId ?? 'standard_m') as VoiceId;
  if ((MATRIX_PERSONAS as readonly string[]).includes(voiceId)) {
    return voiceId as MatrixPersona;
  }
  if (personality && PERSONALITY_TO_MATRIX[personality]) {
    return PERSONALITY_TO_MATRIX[personality];
  }
  return 'standard_m';
}

/** Klassifiziert POI in eine Matrix-Kategorie. */
export function classifyLocationCategory(poi: PoiWithFacts): LocationCategory {
  const blob = `${poi.name} ${poi.facts.map((f) => f.fact_text).join(' ')}`.toLowerCase();

  if (
    /(café|cafe|kaffee|bäck|baeck|restaurant|gastronom|imbiss|rösterei|konditorei|wirtshaus|kneipe)/i.test(
      blob,
    )
  ) {
    return 'cafe';
  }
  if (
    /(kirche|dom|kapelle|cathedral|kloster|münster|muenster|sakral|mahnmal)/i.test(
      blob,
    )
  ) {
    return 'church';
  }
  if (
    /(hafen|landungsbrücken|fähre|faehre|fluss|see\b|kanal|schiff|maritim|wasser|elbufer|alster|hadag)/i.test(
      blob,
    )
  ) {
    return 'water';
  }
  if (/(museum|galerie|ausstellung|speicher.*museum|kaispeicher)/i.test(blob)) {
    return 'museum';
  }
  if (
    /(einkauf|shopping|mall|passage|meile|geschäft|geschaefte|ladenzeile|mönckeberg|moenckeberg|kaufhaus)/i.test(
      blob,
    )
  ) {
    return 'mall';
  }
  if (
    /(denkmal|historisch|schloss|burg|rathaus|fabrik|mühle|muehle|bauwerk)/i.test(
      blob,
    )
  ) {
    return 'historic';
  }
  return 'generic';
}

function matrixEntryForCategory(
  category: LocationCategory,
): CategoryMatrixEntry | null {
  if (category === 'historic') {
    // Historische Bauwerke → Kirchen-/Sakral-Muster als nächste Referenz
    return CATEGORY_TRANSFORM_MATRIX.church;
  }
  if (category === 'generic') return null;
  return CATEGORY_TRANSFORM_MATRIX[category] ?? null;
}

/**
 * Prompt-Block: erkannte Kategorie + aktive Persona + volle Persona-Zeile.
 */
export function buildCategoryTransformBlock(
  poi: PoiWithFacts,
  profile?: UserProfile | null,
  personality?: string | null,
): string {
  const category = classifyLocationCategory(poi);
  const persona = resolveMatrixPersona(profile, personality);
  const entry = matrixEntryForCategory(category);

  const rules = `## Kategorie-Transform-Matrix (streng)
1. Wähle den Stil strikt nach Persona \`${persona}\` (userProfile.voiceId / Persönlichkeit).
2. Übersetze Zahlen in JEDER Persona bildhaft (Höhe → Blick hoch, Preise → „gut sechs Euro“, Mengen → greifbare Bilder).
3. Keine trockene Faktenaufzählung — Geschichte statt Liste.
4. Pipeline: Fast Hook wurde bereits gesprochen (< 200ms) — hier nur der Hauptteil, Hook nicht wiederholen.
5. Übernimm den Transformations-Stil der Few-Shots, aber nutze NUR die echten POI-Fakten unten (keine erfundenen Speicherstadt-/Nikolai-Details).`;

  if (!entry) {
    return `${rules}

### Erkannte Kategorie: allgemein / historisch
Kein exaktes Café-/Kirche-/Hafen-Muster. Nutze die allgemeine Vorher-Nachher-Bibliothek und den Persona-Stil von \`${persona}\`.`;
  }

  const active = entry.transforms[persona];
  const allPersonas = MATRIX_PERSONAS.map(
    (p) => `* ${p}: „${entry.transforms[p]}“`,
  ).join('\n');

  // Aktive Persona in 1–2 anderen Kategorien als Stil-Anker
  const crossRefs = (
    Object.keys(CATEGORY_TRANSFORM_MATRIX) as Array<
      keyof typeof CATEGORY_TRANSFORM_MATRIX
    >
  )
    .filter((k) => k !== entry.id)
    .slice(0, 2)
    .map((k) => {
      const e = CATEGORY_TRANSFORM_MATRIX[k];
      return `* ${e.labelDe}: „${e.transforms[persona]}“`;
    })
    .join('\n');

  return `${rules}

### Erkannte Kategorie: ${entry.labelDe} (\`${category}\`)
📄 DB-Rohdaten (Beispiel-Muster): „${entry.rawExample}“

### PFLICHT — Schreibe genau im Stil von \`${persona}\`
Vorher→Nachher für diese Persona:
„${active}“

### Vollständige Persona-Referenz (gleiche Kategorie)
${allPersonas}

### Stil-Anker derselben Persona in anderen Kategorien
${crossRefs}`;
}

/** Offline-Fallback: Matrix-Satz der aktiven Persona (nur Stil, generisch). */
export function pickCategoryOfflineHook(
  poi: PoiWithFacts,
  profile?: UserProfile | null,
  personality?: string | null,
): string | null {
  const category = classifyLocationCategory(poi);
  const persona = resolveMatrixPersona(profile, personality);
  const entry = matrixEntryForCategory(category);
  if (!entry) return null;
  // Nicht den Beispiel-Ort wörtlich übernehmen — nur wenn Name passt, sonst null
  const examplePlace = entry.rawExample.split(/[,.]/)[0]?.trim() ?? '';
  if (
    examplePlace &&
    poi.name.toLowerCase().includes(examplePlace.toLowerCase().slice(0, 8))
  ) {
    return entry.transforms[persona];
  }
  return null;
}
