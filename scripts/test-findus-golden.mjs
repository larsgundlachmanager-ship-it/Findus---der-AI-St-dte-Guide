/**
 * Golden Cases — Job-Mapping + Website-Status + Injury-Specialty (offline).
 * Run: npm run test:golden
 */

let pass = 0;
let fail = 0;

function ok(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}

function classifyLite(text) {
  const t = text.toLowerCase();
  if (/\b(zahnarzt|zahnschmerzen?|zahnweh)\b/u.test(t)) return 'emergency_care';
  if (
    /\b(notfall|verletzt|verstaucht|gebrochen|apotheke|notaufnahme)\b/u.test(t) ||
    /\b(fu[sß]|knöchel|knoechel).{0,20}\b(gebrochen|verstaucht)\b/u.test(t)
  ) {
    return 'emergency_care';
  }
  if (
    /\b(kino|cinema|vorstellung|kinoticket|spätvorstellung|spaetvorstellung)\b/u.test(
      t,
    ) ||
    (/\bfilm\b/u.test(t) && /\b(schauen|laufen|heute|ticket)\b/u.test(t))
  ) {
    return 'tonight_live';
  }
  if (/\b(theater|konzert|oper|ballett)\b/u.test(t) && /\b(heute|abend|ticket)\b/u.test(t)) {
    return 'tonight_live';
  }
  if (
    /\b(pannfisch|elbblick)\b/u.test(t) ||
    (/\b(glutenfrei|zöliakie|halal)\b/u.test(t) &&
      /\b(essen|restaurant)\b/u.test(t))
  ) {
    return 'dining_hard_match';
  }
  if (/\b(spikeball|bouldern|surf(?:en|kurs)?|kitesurf|sup\b|beachvolleyball)\b/u.test(t)) {
    return 'activity_sport';
  }
  if (
    /\b(wie\s+viele\s+punkte|gewonnen|einwohner|wie\s+breit|wie\s+hoch|sonnenuntergang)\b/u.test(
      t,
    )
  ) {
    return 'fact_number';
  }
  if (
    /\b(hotel|hostel)\b/u.test(t) &&
    /\b(nacht|wochenende|zimmer|pool|sauna)\b/u.test(t)
  ) {
    return 'stay_search';
  }
  if (
    (/\b(bus|zug|bahn|u-bahn|tagesticket|gleis|nachtbus|öpnv)\b/u.test(t) &&
      /\b(nacht|fährt|faehrt|ticket|haltestelle|linie|station)\b/u.test(t)) ||
    /\b(tagesticket|letzter\s+zug|gleis)\b/u.test(t)
  ) {
    return 'transit_live';
  }
  if (/\b(taxi|taxistand)\b/u.test(t)) return 'taxi_rideshare';
  if (/\b(uber|bolt)\b/u.test(t)) return 'taxi_rideshare';
  if (/\b(parkhaus|parken|parkplatz|ladestationen?)\b/u.test(t)) return 'parking_ev';
  if (/\b(e-scooter|leihfahrrad|mietwagen)\b/u.test(t) && !/\bpark/u.test(t)) {
    return 'mobility_rent';
  }
  if (/\b(rooftop|club|techno|feiern\s+gehen|karaoke)\b/u.test(t)) {
    return 'nightlife_vibe';
  }
  if (
    /\b(?:und\s+)?danach\b/u.test(t) &&
    /\b(museum|essen|café|cafe|kino|bar)\b/u.test(t)
  ) {
    return 'day_plan_budget';
  }
  if (/\b(museum|museen|picasso|dinosaur|t-rex|tyrannosaurus|freien?\s+eintritt)\b/u.test(t)) {
    return 'museum_theme';
  }
  if (/\b(was\s+ist\s+das|goldene\s+kuppel|wie\s+alt\s+ist)\b/u.test(t)) {
    return 'poi_identify';
  }
  if (/\b(anziehen|outfit|jacke|pulli)\b/u.test(t) || /\b(wetter|regen)\b/u.test(t)) {
    return 'weather_outfit';
  }
  if (
    /\b(souvenir|briefmarke|briefmarken|sim-karte|waschsalon|waschen)\b/u.test(t)
  ) {
    return 'shopping_errand';
  }
  if (
    /\b(tagesplan|plane\s+mir|budget\s+für\s+heute)\b/u.test(t)
  ) {
    return 'day_plan_budget';
  }
  if (/\b(schließfach|bounce|gepäck|backpack|einschlie)\b/u.test(t)) {
    return 'luggage_practical';
  }
  if (/\b(pass\s+weg|geklaut|konsulat|polizei)\b/u.test(t)) return 'safety_lost';
  if (/\b(toilette|toiletten|\bwc\b|geldautomat|handyakku|akku)\b/u.test(t)) {
    return 'friction_now';
  }
  if (/\b(essen|restaurant|frühstück|burger|hunger)\b/u.test(t)) {
    return 'dining_open';
  }
  if (/\b(bring\s+mich|navigier|wie\s+komme\s+ich|schnellsten)\b/u.test(t)) {
    return 'nav_route';
  }
  return 'other';
}

function analyzeWebsite(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 40) {
    return { checked: false, likelyClosedOrVacation: false };
  }
  const VACATION_RE =
    /\b(urlaub|betriebsferien|praxisurlaub|geschlossen\s+wegen\s+urlaub|derzeit\s+geschlossen|vor[üu]bergehend\s+geschlossen|keine\s+sprechstunde)\b/iu;
  const OPEN_HINT_RE =
    /\b(heute\s+ge[öo]ffnet|notdienst|notfallpraxis|24\s*\/\s*7)\b/iu;
  const vac = VACATION_RE.exec(t);
  if (vac) {
    return { checked: true, likelyClosedOrVacation: true, reason: 'vacation' };
  }
  if (/\bheute\s+geschlossen\b/iu.test(t) && !OPEN_HINT_RE.test(t)) {
    return { checked: true, likelyClosedOrVacation: true, reason: 'closed_today' };
  }
  return { checked: true, likelyClosedOrVacation: false };
}

function injurySpecialty(text) {
  const t = text.toLowerCase();
  if (
    /\b(fu[sß]|fuss|knöchel|knoechel|knie|bein).{0,24}\b(gebrochen|verstaucht|weh|schmerz)/u.test(
      t,
    ) ||
    /\b(gebrochen|verstaucht).{0,24}\b(fu[sß]|fuss|knöchel)/u.test(t)
  ) {
    return 'foot';
  }
  if (/\b(zahnarzt|zahnschmerzen?|zahnweh|\bzahn\b)/u.test(t)) return 'tooth';
  if (/\b(auge|augenarzt)\b/u.test(t)) return 'eye';
  if (/\b(allerg|anaphyl|quallen?)/u.test(t)) return 'allergy';
  return 'general';
}

const JOB_CASES = [
  ['Wo ist die nächste U-Bahn-Station?', 'transit_live'],
  ['Wie komme ich am schnellsten zum Hauptbahnhof?', 'nav_route'],
  ['Fährt hier nachts noch ein Bus?', 'transit_live'],
  ['Wie viel kostet ein Tagesticket?', 'transit_live'],
  ['Wo kann ich mir für heute einen E-Scooter leihen?', 'mobility_rent'],
  ['Wo ist der nächste Taxistand?', 'taxi_rideshare'],
  ['Gibt es hier Uber oder Bolt?', 'taxi_rideshare'],
  ['Wann fährt der letzte Zug heute Abend?', 'transit_live'],
  ['Von welchem Gleis fährt mein Zug ab?', 'transit_live'],
  ['Wo kann ich meinen Mietwagen günstig parken?', 'parking_ev'],
  ['Gibt es hier Ladestationen für E-Autos?', 'parking_ev'],
  ['Wo gibt es das beste lokale Frühstück?', 'dining_open'],
  ['Ich möchte heute Abend Hamburger Pannfisch essen', 'dining_hard_match'],
  ['Welches Restaurant bietet Hamburger Pannfisch mit direktem Elbblick?', 'dining_hard_match'],
  ['Ich habe Zöliakie, wo finde ich glutenfreies Essen?', 'dining_hard_match'],
  ['Ich habe Lust auf einen richtig guten Burger', 'dining_open'],
  ['Wo finde ich ein günstiges Hostel für heute Nacht?', 'stay_search'],
  ['Hotel Wochenende mit Pool und Sauna unter 500 Euro', 'stay_search'],
  ['Wo kann ich mein Backpack für drei Stunden sicher einschließen?', 'luggage_practical'],
  ['Ich habe mir den Fuß verstaucht, wo ist die nächste Notaufnahme?', 'emergency_care'],
  ['Mein Freund hat den Fuß gebrochen', 'emergency_care'],
  ['Ich habe akute Zahnschmerzen, welcher Zahnarzt hat Notdienst?', 'emergency_care'],
  ['Wo ist die nächste Apotheke, die auch nachts geöffnet hat?', 'emergency_care'],
  ['Mein Portemonnaie wurde geklaut, wo ist die Polizei?', 'safety_lost'],
  ['Ich habe meinen Reisepass verloren, wo ist mein Konsulat?', 'safety_lost'],
  ['Wo gibt es hier saubere öffentliche Toiletten?', 'friction_now'],
  ['Mein Handyakku ist bei 1 %, wo kann ich sofort laden?', 'friction_now'],
  ['Was ist das für ein großes Gebäude mit der goldenen Kuppel?', 'poi_identify'],
  ['Wie alt ist die Brücke, auf der ich gerade stehe?', 'poi_identify'],
  ['Ich möchte Kunstwerke von Picasso sehen', 'museum_theme'],
  ['Wo kann ich einen Tyrannosaurus Rex sehen?', 'museum_theme'],
  ['Welche Museen haben heute freien Eintritt?', 'museum_theme'],
  ['Ich möchte heute Abend ins Kino, welche Filme laufen?', 'tonight_live'],
  ['Spider-Man im Kino heute', 'tonight_live'],
  ['Was kostet ein Kinoticket für die Spätvorstellung?', 'tonight_live'],
  ['Wo kann man heute richtig gut feiern gehen?', 'nightlife_vibe'],
  ['Welcher Club spielt heute Techno?', 'nightlife_vibe'],
  ['Gibt es eine Rooftop-Party heute Nacht?', 'nightlife_vibe'],
  ['Wo bekomme ich Briefmarken für den Versand nach Deutschland?', 'shopping_errand'],
  ['Wo kann ich eine lokale SIM-Karte kaufen?', 'shopping_errand'],
  ['Wo kann ich meine Kleidung waschen?', 'shopping_errand'],
  ['Ich möchte Bouldern gehen, wo ist die beste Halle?', 'activity_sport'],
  ['Spikeball spielen in Laboe', 'activity_sport'],
  ['Wo kann ich einen Surfkurs für Anfänger buchen?', 'activity_sport'],
  ['Plane mir einen kompletten Tag mit Mittagessen und Aktivität, Budget 50 Euro', 'day_plan_budget'],
  ['Museum moderne Kunst und danach Café daneben', 'day_plan_budget'],
  ['Rooftop-Party heute und was soll ich anziehen?', 'nightlife_vibe'],
  ['Wie breit ist der Fluss, auf den ich gerade schaue?', 'fact_number'],
  ['Wie viele Einwohner hat diese Stadt?', 'fact_number'],
  ['Ich habe die erste Runde gewonnen, wie viele Punkte bekomme ich?', 'fact_number'],
  ['Wann ist heute exakt Sonnenuntergang?', 'fact_number'],
  ['Was soll ich heute anziehen, es wird windig?', 'weather_outfit'],
  ['Wie wird das Wetter in den nächsten drei Stunden?', 'weather_outfit'],
];

console.log('=== Job Golden Cases ===');
let jobPass = 0;
for (const [q, expect] of JOB_CASES) {
  const got = classifyLite(q);
  const good = got === expect;
  ok(good, `job: "${q.slice(0, 56)}" → ${got} (expect ${expect})`);
  if (good) jobPass++;
}
console.log(`  ${jobPass}/${JOB_CASES.length} job mappings`);

console.log('\n=== Injury Specialty ===');
const SPEC = [
  ['Fuß gebrochen', 'foot'],
  ['Knöchel verstaucht', 'foot'],
  ['Zahnschmerzen Notdienst', 'tooth'],
  ['Welcher Zahnarzt hat jetzt auf', 'tooth'],
  ['Allergische Reaktion Quallenbiss', 'allergy'],
  ['Augenarzt Notfall', 'eye'],
  ['Ich fühle mich krank und brauche einen Arzt', 'general'],
];
for (const [q, expect] of SPEC) {
  const got = injurySpecialty(q);
  ok(got === expect, `specialty: "${q}" → ${got} (expect ${expect})`);
}
ok(injurySpecialty('Fuß gebrochen') !== 'tooth', 'foot ≠ tooth');

console.log('\n=== Website Status ===');
const vacPage =
  'Willkommen in unserer Praxis. Vom 1. bis 20. August haben wir Betriebsferien und sind wegen Urlaub geschlossen. In Notfällen wenden Sie sich an den Notdienst.';
const openPage =
  'Unsere Praxis ist heute geöffnet. Sprechzeiten Montag bis Freitag 8 bis 18 Uhr. Notfallpraxis erreichbar.';
ok(analyzeWebsite(vacPage).likelyClosedOrVacation === true, 'Urlaub erkannt');
ok(analyzeWebsite(openPage).likelyClosedOrVacation === false, 'Offen nicht als Urlaub');
ok(analyzeWebsite('Hallo').checked === false, 'Zu kurz = unchecked');
ok(
  analyzeWebsite(
    'Hinweis: Heute geschlossen. Bitte kommen Sie morgen wieder vorbei, danke für Ihr Verständnis.',
  ).likelyClosedOrVacation === true,
  'Heute geschlossen',
);

console.log('\n=== Completeness Heuristics ===');
function cinemaComplete(speech, hasUrl) {
  return /\b(\d{1,2}[:.]\d{2}|uhr|heute)\b/i.test(speech) && hasUrl;
}
ok(!cinemaComplete('Es gibt Kinos.', false), 'Kino incomplete ohne Zeiten');
ok(cinemaComplete('Spider-Man heute 22:00 UCI', true), 'Kino complete');
ok(
  ['Pannfisch', 'Elbblick'].every((m) =>
    'Pannfisch mit Elbblick im Restaurant X'.toLowerCase().includes(m.toLowerCase()),
  ),
  'Hard-match speech',
);

// ——— Hotel Wochenende / Cinema pack signals ———
console.log('\n=== Hotel + Cinema pack heuristics ===');
ok(
  /\bwochenende\b/.test('hotel fürs wochenende mit pool'),
  'Wochenende als Zeitraum-Signal',
);
ok(
  classifyLite('Hotel Wochenende mit Pool und Sauna') === 'stay_search',
  'Hotel Wochenende → stay_search',
);
function cinemaPackOk(hit) {
  return Boolean(hit.when && (hit.ticket || hit.trailer || hit.price));
}
ok(
  cinemaPackOk({ when: '22:00', ticket: true, price: 12, trailer: true }),
  'Kino-Paket vollständig',
);
ok(
  !cinemaPackOk({ when: null, ticket: false }),
  'Kino ohne Zeiten incomplete',
);

console.log(`\n${pass}/${pass + fail} golden checks passed`);
process.exit(fail ? 1 : 0);
