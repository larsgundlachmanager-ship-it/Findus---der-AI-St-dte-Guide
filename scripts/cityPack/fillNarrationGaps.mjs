#!/usr/bin/env node
/**
 * Fill Module-1 narration gaps + strip ephemeral prices for wangerooge/prisdorf.
 *
 *   node scripts/cityPack/fillNarrationGaps.mjs --city wangerooge --apply
 *   node scripts/cityPack/fillNarrationGaps.mjs --city prisdorf --apply
 */

import {
  arg,
  hasFlag,
  loadPack,
  savePack,
  triggerForSpot,
} from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';

/** Stable Offline-[Erzählung] ≥80 chars — no prices. */
const NARRATION = {
  // --- Wangerooge ---
  wangerooge_fahranleger_wangerooge:
    'Am Südwest-Anleger berührt die Tideinsel den Festlandstakt: Hier dockt die Fähre an, und die Schmalspur-Inselbahn übernimmt den Transfer Richtung Dorfbahnhof — Gepäcklogik startet schon in Harlesiel.',
  wangerooge_neuer_leuchtturm_wangerooge:
    'Am Weststrand steht der Neue Leuchtturm als aktives Seezeichen seit November 1969 — Nachfolger des Alten Leuchtturms im Dorf. Darunter, bei Ebbe, kommen die Fundamente des gesprengten Westturms zum Vorschein.',
  wangerooge_haus_am_alten_leuchtturm:
    'Neben dem Alten Leuchtturm im Dorfkern liegt das Haus Am Alten Leuchtturm — ein ruhiger Ankerpunkt der Inselgeschichte, wo Wohnen und Museumsnähe eng beieinanderliegen.',
  wangerooge_obere_strandpromenade:
    'Die Obere Strandpromenade führt entlang der Dünenkante: hier wechselt der Blick zwischen Dorf, Caféterrassen und dem offenen Nordhorizont — klassische Insel-Orientierung zu Fuß.',
  wangerooge_meerwasser_erlebnisbad_oase:
    'An der Oberen Strandpromenade liegt die Meerwasser-Oase: Hallenbad mit Nordseewasser-Atmosphäre, wenn Wind und Wetter draußen den Strandurlaub pausieren lassen.',
  wangerooge_lazarettbunker_wangerooge:
    'In der Jadestraße steckt der Lazarettbunker als erhaltenes Kriegsbauwerk mitten im Dorf — ein Ort, der Militärgeschichte greifbar macht, ohne sie zu verklären.',
  wangerooge_hauptstrand:
    'Am Hauptstrand auf der Nordseite wird Inselurlaub greifbar: breiter Sand, Wind und Horizont, erreichbar über die Promenade und die Dünenübergänge.',
  wangerooge_st_willehad:
    'Am Bootsweg steht St. Willehad — katholische Kirche und Mutter-Kind-Klinik teilen sich den Standortbereich und prägen den östlichen Dorfrand neben dem Sakralraum.',
  wangerooge_golfclub:
    'Am Jadehörn teilen sich Golfclub und Inselflugplatz dasselbe Gelände — neun Löcher neben der Startbahn, ein bundesweit seltenes Inselkonzept.',
  wangerooge_polizei:
    'In der Charlottenstraße sitzt die Inselwache der Polizei Niedersachsen: der feste Ansprechpunkt für Ordnung und Notruf auf Wangerooge.',
  wangerooge_insel_apotheke:
    'In der Zedeliusstraße versorgt die Insel-Apotheke das Dorf mit Medikamenten — zentrale Gesundheitsadresse mitten in der Fußgängerzone.',
  wangerooge_lzo_geldautomat:
    'An der Zedeliusstraße steht die barrierefreie LzO-SB-Filiale: Geldautomat mit langen Öffnungsfenstern für Inselgäste ohne Bankfiliale um die Ecke.',

  // --- Prisdorf ---
  prisdorf_zahnarztpraxis:
    'In der Bahnhofstraße praktizieren Heilmann und von Döhren Zahnmedizin inkl. Implantologie und Angstpatienten-Betreuung — Fachversorgung mitten im Dorf, ohne Extra-Fahrt in die Kreisstadt.',
  prisdorf_friseur_klier:
    'Im Marktkauf-Center am Peiner Hag sitzt Frisör Klier: Kettenfriseur mit Online-Termin, direkt beim Wocheneinkauf — schnelle Alltagsversorgung statt Extra-Weg.',
  prisdorf_coiffeur_jensen:
    'In Schnickenfeld 53 führt Coiffeur C. Jensen den klassischen Dorffriseur abseits der Mall-Filialen — persönlicher Salon im Wohngebiet.',
  prisdorf_kkiosk_post:
    'Im Marktkauf bündelt der kkiosk Post und DHL: Briefe, Pakete, Tabak und Lotto — die letzten Meter staatlicher Infrastruktur im Center-Format.',
  prisdorf_pm_service:
    'Am Peiner Hag repariert PM Service Schuhe und schneidet Schlüssel nach — altes Handwerk im Center, wenn Reißverschluss oder Schlüsselbund den Alltag stoppen.',
  prisdorf_kitz_jungtierrettung:
    'Die Kitz- und Jungtierrettung Prisdorf rettet seit Herbst 2023 Rehkitze per Drohne mit Wärmebild — ehrenamtliche Technikhilfe in der Feldmark vor der Mahd.',
  prisdorf_loeschbrunnen_außenbezirke:
    'In Hauen und Rehmen stehen historische Löschbrunnen der Feuerwehr: Hauen seit 1954 (rund 15,5 m tief), Rehmen seit 1964 — stille Infrastruktur am Dorfrand.',
  prisdorf_kirche_kummerfeld:
    'Prisdorf gehört zur Ev.-Luth. Kirchengemeinde Kummerfeld mit der Osterkirche von 1970 — Gemeindeleben und Gottesdienste jenseits der eigenen Dorfgrenze.',
  prisdorf_bilsbekraum:
    'Im Gemeindezentrum Hudenbarg 5 öffnet der Bilsbekraum für Versammlungen und Bürgertermine — benannt nach dem Dorfbach, der Prisdorf prägt.',
  prisdorf_reiterverein_bilsbek:
    'Der Reiterverein Am Bilsbek besteht seit 1924 und trägt den Flussnamen aus Prisdorf — regionaler Pferdesport mit langer Vereinsgeschichte bis Pinneberg.',
  prisdorf_blume_aktuell:
    'Im Marktkauf am Peiner Hag steht Blume aktuell für Sträuße und Gestecke — Floristik für Fest und Trauer, ohne Extra-Weg nach Pinneberg.',
  prisdorf_krause_karosserie:
    'In der Werkstraße 11 arbeitet Krause an Karosserie und Lack — Handwerk im Gewerbegebiet hinter dem Schaufenster Peiner Hag.',
  prisdorf_ernstings_family:
    'Ernsting’s family im Marktkauf liefert Familienmode direkt beim Einkauf — praktischer Stopp im Center, ohne eigene Modezeile im Dorfkern.',
  prisdorf_wald_hauen:
    'Am Dorfrand öffnet der Wald Hauen Knicks und Reddern zur Naherholung — Spazieren, Hunde und ruhige Köpfe zwischen Feldmark und Geesthang.',
  prisdorf_star_textilreinigung:
    'Die Star Textilreinigung im Marktkauf nimmt Hemden, Anzüge und Wintermäntel mit — Dienstleistung, die früher eigene Ladenzeilen brauchte.',
};

/** Category fixes / missing Module-1 coverage. */
const CATEGORY_FIX = {
  prisdorf_tsv_sportgelände: 'freizeit',
  prisdorf_tcp_tennis: 'freizeit',
  prisdorf_peiner_hof: 'freizeit',
  prisdorf_pinnau_ufer: 'aussicht',
  prisdorf_eisenbahnbrücke_hudenbarg: 'aussicht',
  prisdorf_wald_hauen: 'natur',
  prisdorf_kitz_jungtierrettung: 'natur',
  prisdorf_loeschbrunnen_außenbezirke: 'sicherheit',
  prisdorf_blume_aktuell: 'einkaufen',
  prisdorf_krause_karosserie: 'service',
  prisdorf_ernstings_family: 'einkaufen',
  prisdorf_team_tankstelle: 'service',
  prisdorf_jagdgemeinschaft: 'natur',
  prisdorf_prisdorf_net: 'verwaltung',
  wangerooge_meerwasser_erlebnisbad_oase: 'freizeit',
};

const PRICE_RE =
  /\d+[.,]\d{2}\s*€|\b(eintritt|zimmer|parken|fähre|fähre|menü|menu)\s*:?\s*\d+([.,]\d+)?\s*€?/gi;

function stripPrices(text) {
  let t = String(text || '');
  t = t.replace(/\d+[.,]\d{2}\s*€/g, '[Preis live recherchieren]');
  t = t.replace(
    /\b(eintritt|zimmer|parken|fähre|fährscheine?|menü|menu|frühstücksbüfett|abendbüfett)\s*:?\s*\d+([.,]\d+)?\s*€?/gi,
    '$1: [live]',
  );
  // Stand-Recherche price dumps → live hint sentence
  if (/\[Preis live|\[live\]/i.test(t) && /€|preis|tarif/i.test(t)) {
    // keep structure but mark
  }
  return t.trim();
}

function ensureLivePriceHint(trigger, topic) {
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const hint = {
    text: `LIVE: ${topic} — aktuelle Preise/Tarife frisch suchen, nie aus dem Pack vorlesen.`,
    tags: ['live_hint', 'ephemeral', 'preise'],
  };
  const key = hint.text.toLowerCase().slice(0, 50);
  if (
    trigger.deep_data_pool.some((e) =>
      String(typeof e === 'string' ? e : e?.text || '')
        .toLowerCase()
        .includes(key.slice(0, 35)),
    )
  ) {
    return;
  }
  trigger.deep_data_pool.push(hint);
}

function scrubSpotPrices(pack, spotId) {
  const spot = pack.spots.find((s) => s.id === spotId);
  const t = triggerForSpot(pack, spot);
  if (!spot || !t) return 0;
  let n = 0;
  if (spot.bullets) {
    spot.bullets = spot.bullets.map((b) => {
      const next = stripPrices(b);
      if (next !== b) n += 1;
      return next;
    });
  }
  if (spot.facts) {
    for (const k of ['origin', 'architecture', 'now', 'famousPersonConnected']) {
      if (spot.facts[k] && PRICE_RE.test(spot.facts[k])) {
        spot.facts[k] = stripPrices(spot.facts[k]);
        n += 1;
      }
    }
  }
  if (t.general_info && PRICE_RE.test(t.general_info)) {
    t.general_info = stripPrices(t.general_info);
    n += 1;
  }
  t.deep_data_pool = (t.deep_data_pool || []).map((e) => {
    if (typeof e === 'string') {
      const next = stripPrices(e);
      if (next !== e) n += 1;
      return next;
    }
    const text = stripPrices(e.text || '');
    if (text !== e.text) n += 1;
    return { ...e, text };
  });
  ensureLivePriceHint(
    t,
    spot.category === 'hotel' || /hotel|pension/i.test(spot.name)
      ? 'Zimmerpreise & Verfügbarkeit'
      : /fähre|anleger|bahnhof|harlesiel/i.test(spot.id + spot.name)
        ? 'Fähr-/Shuttle-/Parktarife'
        : 'aktuelle Preise',
  );
  return n;
}

function main() {
  const cityId = arg('city');
  if (!cityId) {
    console.error(
      'Usage: node scripts/cityPack/fillNarrationGaps.mjs --city wangerooge|prisdorf [--apply]',
    );
    process.exit(1);
  }
  const apply = hasFlag('apply');
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack not found: ${cityId}`);

  let narr = 0;
  let cats = 0;
  let prices = 0;

  for (const [id, text] of Object.entries(NARRATION)) {
    const spot = pack.spots.find((s) => s.id === id);
    if (!spot) continue;
    const t = triggerForSpot(pack, spot);
    if (!t) continue;
    const prev = (t.general_info || '').trim();
    if (prev === text) continue;
    if (prev.length >= 80 && !hasFlag('force') && prev.length >= text.length) {
      // keep richer existing narration
      continue;
    }
    t.general_info = text;
    narr += 1;
  }

  for (const [id, cat] of Object.entries(CATEGORY_FIX)) {
    const spot = pack.spots.find((s) => s.id === id);
    if (!spot) continue;
    if (spot.category !== cat) {
      spot.category = cat;
      spot.tags = [...new Set([...(spot.tags || []), cat, 'gap_fill'])];
      cats += 1;
    }
  }

  if (cityId === 'wangerooge') {
    for (const id of [
      'wangerooge_db_bahnhof_wangerooge',
      'wangerooge_fahranleger_wangerooge',
      'wangerooge_strandhotel_gerken',
      'wangerooge_inselverein_des_gutenbergheims_wangerooge_e_v',
      'wangerooge_strandburg',
      'harlesiel_faehrhafen',
    ]) {
      prices += scrubSpotPrices(pack, id);
    }
  }

  // Re-count is narr applied above

  console.log(
    `[fill] ${cityId} narrations=${narr} categoryFixes=${cats} priceScrubs=${prices}`,
  );

  if (apply) {
    const file = savePack(pack, { bumpVersion: true });
    console.log(`[fill] wrote ${file}`);
  }
  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[fill] gate ok=${gate.ok} errors=${gate.errors.length} warnings=${gate.warnings.length} needsNarration=${gate.gaps.needsNarration.length} missingCats=${gate.gaps.missingCategories.join(',') || 'ok'}`,
  );
  if (gate.gaps.needsNarration.length) {
    console.log('[fill] still short:', gate.gaps.needsNarration);
  }
  const priceW = gate.warnings.filter((w) => /price|Preis/i.test(w));
  if (priceW.length) console.log('[fill] price warns left:', priceW);
}

main();
