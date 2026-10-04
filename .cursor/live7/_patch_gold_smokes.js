const fs = require('fs');
const path = require('path');

function write(p, s) {
  const abs = path.resolve(p);
  const tmp = abs + '.tmpwrite';
  fs.writeFileSync(tmp, s.replace(/\r\n/g, '\n'), 'utf8');
  fs.renameSync(tmp, abs);
}

{
  const p = 'src/module2/blueprints/ownerGold.pack.json';
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const by = Object.fromEntries(j.blueprints.map((b) => [b.situationKey, b]));

  by['general::bridge_understood_commit_v1'].summary =
    'Bridge (Call 1): Nur DIESE User-Nachricht — Wunsch-Art kurz ansteuern (Essen/AYCE/Rad-Route/Wetter/SUP/Reservierung/Trivia-Einleitung) + Zusage. Nie alleinige 0815-Floskel („ich schau mal“, „wissen kommt gleich“, „nützliche Fakten“, „genau das klären wir“) ohne Anker. Ausnahme: fehlender Blocker-Slot → kurze Gegenfrage, bridgeComplete, keine Recherche-Zusage. Nie Meta-Warte. Kurz 1–2 Sätze. Keine Venue-Namen/Preise/Minuten. Call 2 hängt flüssig an — außer bridgeComplete.';

  by['dining::ayce_cuisine_hard_filter_v1'].summary =
    'All-you-can-eat: Hard-Filter — nur Orte mit belegtem AYCE/Buffet-Flatrate (Reviews/Website/Name), offen am genannten Abend. „kein Asiatisch“ = Must-Avoid (cuisine_not_asian). Qualität und Beleg vor Nähe. Soft-Fill mit Café/Eisdiele/Rösterei/normalem Restaurant verboten. Leer lokal → nächste Packs + Live-Expand ringweise bis belegt oder ehrlich leer — nie Fake-Treffer. Speisekarte als Button wenn belegt.';

  by['dining::reserve_sticky_venue_v1'].summary =
    'Tisch reservieren nach Wahl: gleiches Venue (z. B. Rio Grande nach Tap), Reservierungs-URL/Telefon — Bridge sagt Reservierung für DIESES Venue zu. Kein neuer Pitch, keine fremden Orte (kein Goldschätzchen-Ersatz), keine zweite Dual-Option.';

  by['navigation::bike_eta_mode_switch_v1'].summary =
    'Fahrrad/Fuß während aktiver Nav: execution=nav_execute, gleiches Ziel behalten, Profil sofort umstellen und neue ETA sprechen — Bridge „Route mit dem Rad“. Kein Pitch-Modul, keine Restaurants, kein neuer Nav-Start auf Stadtname.';

  by['activity_poi::water_body_activity_followup_v1'].summary =
    'Follow-up zu genanntem Gewässer (Größe→SUP/Stellappell): Bridge geht auf die Frage ein. Call-2 Answer-first ja/nein + wo auf dem Wasser. Optional 1–2 echte Verleihe mit Preisen/Links am selben Gewässer — nie lokale Gastro/Heimatverein/Feuerlöschteich als Ersatz. Alte Pitch-UI ersetzen.';

  by['general::weather_night_sky_woven_outfit_v1'].summary =
    'Wetter locker und menschlich in der Speech: Himmel + Temp/Höchst + Regen-Timing in 1–3 kurzen VOLLEN Sätzen. KEINE Kleidungsvorschläge bei reiner Wetterfrage — Outfit nur wenn Anziehen/Kleidung gefragt. Stichpunkte = FACT-CHIPS (z. B. „Wechselhaft · bis 24°“, „Schauer ab 15 Uhr“) — nie Prosa-Sätze kopieren. Nie Telegramm in der Stimme. Nie Navigation aus Wetterfrage.';

  by['general::weather_not_help_v1'].summary =
    'Wetterfrage: belegter Ausblick (Himmel/Temp/Regen-Timing) flüssig in Speech — keine ungefragte Kleidung. Stichpunkte = FACT-CHIPS (kompakt, max ~2 Zeilen), nie Fließtext. Nie Hilfe-Katalog, nie leeres „keine Live-Daten“, nie Abendplan/Sunset-Queue, nie Navigation starten. Call-1 = kurze Wetter-Zusage ohne Gradzahlen.';

  write(p, JSON.stringify(j, null, 2) + '\n');
  console.log('ownerGold updated', j.blueprints.length);
}

// bridgeGlue smoke
{
  const p = 'src/module2/chat/bridgeGlue.smoke.test.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  s = s.replace(
    `import {
  looksLikeSlotGluedBridge,
  sanitizeBridgeText,
  scrubBridgeCityLeak,
  extractBridgeUserPlace,
} from './bridgeGlue';`,
    `import {
  ensureBridgeAnchoredToAsk,
  looksLikeSlotGluedBridge,
  looksLikeSoleVagueFillerBridge,
  sanitizeBridgeText,
  scrubBridgeCityLeak,
  extractBridgeUserPlace,
} from './bridgeGlue';`,
  );
  s = s.replace(
    `assert(
  sanitizeBridgeText('Ich schau mal kurz') != null,
  'wait floskel kept (no silence)',
);`,
    `assert(
  sanitizeBridgeText('Ich schau mal kurz') === null,
  'sole vague filler killed',
);
assert(
  looksLikeSoleVagueFillerBridge('Wissen kommt gleich') === true,
  'wissen kommt gleich is vague',
);
assert(
  /All-you-can-eat|All-you-can-eat/i.test(
    ensureBridgeAnchoredToAsk('Wissen kommt gleich', 'Morgen All you can eat kein asiatisch') || '',
  ),
  'vague bridge re-anchored to AYCE',
);
assert(
  sanitizeBridgeText('Klar, ich guck kurz nach dem Wetter.') != null,
  'job-anchored weather bridge kept',
);`,
  );
  // remove duplicate weather assert if we duplicated
  const parts = s.split("assert(\n  sanitizeBridgeText('Klar, ich guck kurz nach dem Wetter.') != null,\n  'short weather bridge kept',\n);");
  if (parts.length === 2) {
    s = parts[0] + parts[1];
  }
  write(p, s);
  console.log('bridgeGlue smoke patched');
}

// visualBullets smoke additions
{
  const p = 'src/services/concierge/visualBullets.smoke.test.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  if (!s.includes('looksLikeProseBullet')) {
    s = s.replace(
      `import {
  clampVisualBullets,`,
      `import {
  looksLikeProseBullet,
  clampVisualBullets,`,
    );
    s += `
assert(looksLikeProseBullet('Also, in Prisdorf sieht es so aus, dass es morgen regnet und du eine Jacke brauchst.') === true, 'prose rejected');
assert(looksLikeProseBullet('Wechselhaft · bis 17°') === false, 'chip ok');
{
  const b = clampVisualBullets(['Alter 36 Jahre', '36 Jahre', 'Geboren am 13. September 1989'], {
    speechText: 'Thomas Müller ist 36 Jahre alt. Er wurde am 13. September 1989 geboren.',
    userText: 'Wie alt ist Thomas Müller?',
  });
  assert(b.length <= 3, 'max 3');
  assert(b.filter((x) => /36/.test(x)).length <= 1, 'no duplicate age');
}
{
  const b = clampVisualBullets(['Genaue Preise liegen mir gerade nicht vor'], {
    cardTitle: 'Genaue Preise liegen mir gerade nicht vor',
    speechText: 'Genaue Preise liegen mir gerade nicht vor',
  });
  assert(b.length === 0, 'title duplicate dropped');
}
console.log('visualBullets prose/title/dedupe OK');
`;
    // remove duplicate console.log at end if double
    write(p, s);
    console.log('visualBullets smoke patched');
  }
}

console.log('gold+smokes done');
