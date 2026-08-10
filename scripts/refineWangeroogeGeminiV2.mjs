#!/usr/bin/env node
/**
 * Refine Wangerooge v5 with Gemini follow-up:
 * Harlesiel mainland start, precise micro GPS, emergency spots, 2026 tariffs,
 * Pudding/Hartmann disentangled, Westturm address fix.
 * Local only — no upload.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxPolygon } from './geo/osm.mjs';
import { validateCityPack } from './geo/validatePack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_PATH = path.join(ROOT, 'data/staedte/wangerooge.json');

function dms(d, m, s) {
  return +(d + m / 60 + s / 3600).toFixed(7);
}

function offsetMeters(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: +(lat + dLat).toFixed(7), lng: +(lng + dLng).toFixed(7) };
}

function approachAt(lat, lng, distanceM, bearingDeg, radiusM, id, teaser) {
  const rad = (bearingDeg * Math.PI) / 180;
  const p = offsetMeters(
    lat,
    lng,
    distanceM * Math.cos(rad),
    distanceM * Math.sin(rad),
  );
  return {
    id,
    lat: p.lat,
    lng: p.lng,
    radius_m: radiusM,
    teaser_text: teaser,
    condition_rule: 'always',
  };
}

function centroid(poly) {
  let lat = 0;
  let lng = 0;
  for (const p of poly) {
    lat += p.latitude ?? p.lat;
    lng += p.longitude ?? p.lng;
  }
  return { lat: lat / poly.length, lng: lng / poly.length };
}

function deep(text, tags) {
  return { text, tags: tags || ['sourced_gemini'] };
}

function rebuildArea(spot, lat, lng, halfM = 25) {
  spot.polygonCoordinates = boxPolygon(lat, lng, halfM);
}

function syncTrigger(pack, spot, generalInfo, deepPool) {
  const c = centroid(spot.polygonCoordinates);
  const i = (pack.trigger_points || []).findIndex((t) => t.id === spot.id);
  const tp = {
    id: spot.id,
    name: spot.name,
    lat: c.lat,
    lng: c.lng,
    radius_m: 45,
    trigger_kind: 'area',
    trigger_type: 'polygon',
    polygon: spot.polygonCoordinates.map((p) => ({
      lat: p.latitude,
      lng: p.longitude,
    })),
    general_info: generalInfo,
    deep_data_pool: deepPool,
  };
  if (i >= 0) pack.trigger_points[i] = { ...pack.trigger_points[i], ...tp };
  else {
    pack.trigger_points = pack.trigger_points || [];
    pack.trigger_points.push(tp);
  }
}

function upsertSpot(pack, spot, general, deepPool) {
  const i = pack.spots.findIndex((s) => s.id === spot.id);
  if (i >= 0) pack.spots[i] = { ...pack.spots[i], ...spot };
  else pack.spots.push(spot);
  const live = pack.spots.find((s) => s.id === spot.id);
  syncTrigger(pack, live, general, deepPool);
}

function main() {
  const pack = JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'));

  // Precise GPS from Gemini (DMS) + Google geocodes for addresses
  const GPS = {
    hartmann: { lat: dms(53, 47, 37.5), lng: dms(7, 53, 31.7) },
    // Gemini DMS coincides with Westturm (~error); place near beach S of Neuer LT
    // Official Gemini: 53°47'04.9"N 07°51'27.1"E — logged as conflict
    fundamente_gemini: { lat: dms(53, 47, 4.9), lng: dms(7, 51, 27.1) },
    willehad_gemini: { lat: dms(53, 47, 32), lng: dms(7, 54, 13) },
    willehad_bootsweg: { lat: 53.7910224, lng: 7.9105685 }, // Google Bootsweg 12
    golf: { lat: 53.7892992, lng: 7.9042461 },
    harlesiel: { lat: 53.7033422, lng: 7.8072929 },
    polizei: { lat: 53.7914252, lng: 7.8974325 },
    arzt: { lat: 53.7901113, lng: 7.899472 },
    apotheke: { lat: 53.7913126, lng: 7.8998807 },
    lzo: { lat: 53.7918964, lng: 7.899513 },
    diggers_hq: { lat: 53.7934151, lng: 7.8958476 },
    westturm_addr: { lat: 53.7854658, lng: 7.8526953 },
  };

  const neuer = pack.spots.find((s) => /neuer leuchtturm/i.test(s.name));
  const neuerC = neuer
    ? centroid(neuer.polygonCoordinates)
    : { lat: 53.7895, lng: 7.868 };
  // Foundations: ~south of Neuer Leuchtturm toward beach (Ebbe Lost Place)
  const fundamente = offsetMeters(neuerC.lat, neuerC.lng, -90, -30);

  // ─── Harlesiel mainland start ──────────────────────────────────────
  {
    const id = 'harlesiel_faehrhafen';
    const { lat, lng } = GPS.harlesiel;
    const approaches = [
      approachAt(
        lat,
        lng,
        200,
        0,
        55,
        `${id}_approach_far`,
        'Willkommen in Harlesiel. Hier endet deine Autoreise. Ab hier übernimmt die Tide den Fahrplan. Such dir einen Parkplatz und nimm nur das Wichtigste als Handgepäck mit.',
      ),
      approachAt(
        lat,
        lng,
        50,
        20,
        22,
        `${id}_approach_mid`,
        'Achtung, Gepäckaufgabepflicht! Großes Gepäck darf aus Sicherheitsgründen nicht mit auf die Fähre. Gib deine Koffer jetzt hier an den roten Containern auf. Wenn du im tiefen Westen der Insel wohnst, musst du hier zwingend die Hauszustellung buchen!',
      ),
      approachAt(
        lat,
        lng,
        10,
        30,
        10,
        `${id}_approach_near`,
        'Hast du dein Ticket bereit? Die Überfahrt dauert inklusive der späteren Inselbahnfahrt rund 50 Minuten. Genieß die Fahrt durch das Wattenmeer!',
      ),
    ];
    upsertSpot(
      pack,
      {
        id,
        name: 'Fährhafen Harlesiel (Gepäck- & Logistik-Terminal)',
        district: 'Festland',
        category: 'transport',
        tags: [
          'transport',
          'must_have',
          'gepaeck',
          'harlesiel',
          'pre_start',
          'sourced_gemini',
          'saison_2026',
        ],
        bullets: [
          'Adresse: Hafen Harlesiel, 26409 Wittmund — obligatorischer Festland-Anker vor der autofreien Insel (§ 46 StVO).',
          'Parken Saison 2026: 7,00 € pro angefangenem Tag.',
          'Nur Handgepäck an Bord (max. 2 Stück, 50×40×25 cm). Koffer bis 25 kg: 9,50 €/Stück Hin+Rück — spätestens 1 h vor Abfahrt in rote Container.',
          'West-Gäste (z. B. Jugendherberge): Hauszustellung 19,50 € Hin+Rück zwingend — am Westanleger keine Gepäckausgabe.',
          'Fähre Standard 2026 Hin+Rück: Erw. (ab 15) 46 €, Kind 6–14 28 €, Hund 28 €. Watt Sprinter: Erw. 77 €, Kind 2–14 46 €, Hund 30,50 €.',
        ],
        facts: {
          origin:
            'Harlesiel ist der logistische Flaschenhals zur autofreien Insel Wangerooge — PKW bleiben hier, Gepäck geht in rote Container.',
          architecture:
            'Hafen-Terminal mit Parkplätzen, Gepäckcontainern und Fähr-Gate; Anschluss an Inselbahn nach Ankunft.',
          now: 'Tarife Saison 2026: Parken 7 €/Tag, Gepäck 9,50 €, Hauszustellung 19,50 €, Fähre Erw. 46 €.',
          tags: ['transport', 'harlesiel', 'gepaeck', 'must_have', 'saison_2026'],
        },
        polygonCoordinates: boxPolygon(lat, lng, 55),
        approach_triggers: approaches,
        sub_pois: [
          {
            id: `${id}_sub_container`,
            name: 'Rote Gepäck-Container',
            lat: approaches[1].lat,
            lng: approaches[1].lng,
            radius_m: 16,
            fact_details:
              'Rote Container: Großgepäck spätestens 1 Stunde vor Abfahrt aufgeben. West-Unterkunft → Hauszustellung buchen.',
            tags: ['sub_poi', 'gepaeck'],
          },
          {
            id: `${id}_sub_gate`,
            name: 'Fähr-Gate Harlesiel',
            lat: approaches[2].lat,
            lng: approaches[2].lng,
            radius_m: 10,
            fact_details:
              'Fähr-Gate: Ticket bereithalten. Überfahrt inkl. Inselbahn ca. 50 Minuten.',
            tags: ['sub_poi', 'transport'],
          },
        ],
      },
      'Harlesiel ist der Pre-Start: Hier endet das Auto, hier entscheidet sich die Gepäcklogistik für die ganze Inselreise.',
      [
        deep(
          'Saison 2026: Parken Harlesiel 7,00 €/angefangener Tag. Handgepäck max. 2×50×40×25 cm. Koffer ≤25 kg: 9,50 € Hin+Rück in rote Container (≥1 h vor Abfahrt).',
          ['transport', 'preise', 'saison_2026', 'gepaeck'],
        ),
        deep(
          'Hauszustellung 19,50 € Hin+Rück obligatorisch für Unterkünfte im Insel-Westen (z. B. DJH) — keine Ausgabe am Westanleger.',
          ['transport', 'gepaeck', 'saison_2026'],
        ),
        deep(
          'Fähre Standard 2026 Hin+Rück: Erw. ab 15 J. 46 €, Kind 6–14 28 €, Hund 28 €. Watt Sprinter: Erw. 77 €, Kind 2–14 46 €, Hund 30,50 €.',
          ['transport', 'preise', 'saison_2026'],
        ),
      ],
    );
  }

  // ─── Update Inselbahnhof teasers (Harlesiel cross-ref) ─────────────
  {
    const spot = pack.spots.find(
      (s) => s.id === 'wangerooge_db_bahnhof_wangerooge',
    );
    if (spot) {
      const c = centroid(spot.polygonCoordinates);
      spot.approach_triggers = [
        approachAt(
          c.lat,
          c.lng,
          50,
          0,
          22,
          `${spot.id}_approach_far`,
          'Hier pulsiert die infrastrukturelle Lebensader der Insel. Der Bahnhof Wangerooge ist der logistische Dreh- und Angelpunkt.',
        ),
        approachAt(
          c.lat,
          c.lng,
          20,
          10,
          14,
          `${spot.id}_approach_mid`,
          'Schau auf das logistische Ballett vor dir. Hier am Vorplatz findet die zentrale Gepäckausgabe statt. Erinnerst du dich an den roten Container am Fähranleger in Harlesiel? Genau hier spuckt das System dein Gepäck wieder aus.',
        ),
        approachAt(
          c.lat,
          c.lng,
          5,
          15,
          8,
          `${spot.id}_approach_near`,
          'Zur Linken findest du die stufenlosen Zugänge zur Tourist-Info, rechts die Fahrkartenschalter. Alles hier ist auf Rollstuhlgerechtigkeit geprüft.',
        ),
      ];
      spot.bullets = [
        'Adresse: Bahnhofstraße 6, 26486 Wangerooge — Nadelöhr für Fracht, Passagiere vom Südwest-Anleger und Gepäck.',
        'Fahrkarten, Gepäckabfertigung, Tourist-Info (Saison 08:00–18:00). Barrierefrei PA-13509-2023 inkl. WC.',
        'Gepäckausgabe am Vorplatz — Gegenstück zu den roten Containern in Harlesiel (Saison 2026).',
      ];
      syncTrigger(
        pack,
        spot,
        'Der Inselbahnhof ist die Lebensader Wangerooges: Hier kommt an, was in Harlesiel in die Container ging.',
        [
          deep(
            'Barrierefreiheit Zertifikat PA-13509-2023; Tourist-Info Saison 08–18 Uhr; Gepäckausgabe Vorplatz.',
            ['barrierefreiheit', 'live', 'bahnhof'],
          ),
          deep(
            'Logistik-Kette: Harlesiel rote Container → Fähre → Inselbahn → Bahnhofsvorplatz Wangerooge.',
            ['transport', 'gepaeck', 'harlesiel'],
          ),
        ],
      );
    }
  }

  // ─── Alter Leuchtturm: shortened teasers from v2 report ────────────
  {
    const spot = pack.spots.find(
      (s) => s.id === 'wangerooge_inselmuseum_alter_leuchtturm',
    );
    if (spot) {
      const c = centroid(spot.polygonCoordinates);
      spot.approach_triggers = [
        approachAt(
          c.lat,
          c.lng,
          150,
          180,
          42,
          `${spot.id}_approach_far`,
          'Über den Dächern der Fußgängerzone erhebt sich die markante, graue Zementputz-Fassade des Alten Leuchtturms.',
        ),
        approachAt(
          c.lat,
          c.lng,
          20,
          200,
          14,
          `${spot.id}_approach_mid`,
          'Genau hier, im Schatten des 1855 erbauten Turms, bauten 82 hartnäckige Insulaner nach der zerstörerischen Sturmflut ein neues Leben auf. Beachte zur Rechten die historische Schmalspur-Dampflok.',
        ),
        approachAt(
          c.lat,
          c.lng,
          5,
          210,
          8,
          `${spot.id}_approach_near`,
          'Du stehst nun vor dem Portal. Wenn du die Aussichtsplattform in der alten Laterne genießen möchtest, bereite dich auf einen steilen Aufstieg über exakt 146 historische Stufen vor.',
        ),
      ];
    }
  }

  // ─── Westturm: address Im Westen 38 + updated teasers/bistro ───────
  {
    const spot = pack.spots.find((s) => s.id === 'wangerooge_westturm');
    if (spot) {
      // Keep Places landmark coords (tower); official postal address corrected
      const c = centroid(spot.polygonCoordinates);
      spot.bullets = [
        'Offizielle Adresse: Im Westen 38, 26486 Wangerooge (DJH/Post). Google navigiert teils über „Straße zum Westen“ — postalisch inkorrekt.',
        '56 m Backsteinturm 1932–33 auf 124 Eisenbetonpfählen; Nachbau des Alten Westturms (1597–1602, ~900 m SSE, 1914 gesprengt).',
        'Heute DJH-Jugendherberge; Innenraum für Tagesgäste gesperrt. DJH-Fahrradverleih am Gelände.',
        'DJH-Bistro Westturm: täglich 11:00–17:00 Snacks/Getränke auch für Spaziergänger auf der Sonnenterrasse.',
      ];
      spot.facts = {
        origin:
          'Westturm 1932/33 als Nachbau des 1914 gesprengten Turms von 1602 — Wahrzeichen und einstige Sturmflut-Zuflucht.',
        architecture:
          '56 m, drei Spitzen (historisch Peilhilfe), 124 Eisenbetonpfähle. Adresse Im Westen 38.',
        now: 'DJH-Herberge (Innen nur Hausgäste); Bistro 11–17 Uhr für Spaziergänger; Fahrradverleih.',
        tags: ['aussicht', 'must_have', 'djh', 'geschichte'],
      };
      spot.tags = Array.from(
        new Set([...(spot.tags || []), 'djh', 'adresse_klaerung']),
      );
      spot.approach_triggers = [
        approachAt(
          c.lat,
          c.lng,
          200,
          90,
          48,
          `${spot.id}_approach_far`,
          'Vor dir in der Dünenlandschaft erhebt sich massiv das 56 Meter hohe Wahrzeichen der Insel: Der Westturm. Die drei charakteristischen Spitzen waren einst überlebenswichtig für die Peilung der Handelsschiffe in der Nordsee.',
        ),
        approachAt(
          c.lat,
          c.lng,
          50,
          95,
          22,
          `${spot.id}_approach_mid`,
          'Der Backsteinbau, auf den du zugehst, stammt aus dem Jahr 1932 und ist heute eine Jugendherberge. Der Originalturm aus dem Jahr 1602 stand etwa 900 Meter von hier entfernt.',
        ),
        approachAt(
          c.lat,
          c.lng,
          10,
          100,
          10,
          `${spot.id}_approach_near`,
          'Du stehst nun vor dem achteckigen Bau, der auf 124 Eisenbetonpfählen ruht. Der Turm selbst ist im Inneren Herbergsgästen vorbehalten, aber das DJH-Bistro lädt Spaziergänger zu einer Pause auf der Terrasse ein.',
        ),
      ];
      syncTrigger(
        pack,
        spot,
        'Der Westturm (Im Westen 38) ist Wahrzeichen und DJH — Tagesgäste bleiben außen, das Bistro lädt auf die Terrasse.',
        [
          deep(
            'Offizielle Adresse Im Westen 38 (nicht „Straße zum Westen“). DJH-Bistro täglich 11–17 Uhr auch für Spaziergänger.',
            ['live', 'djh', 'adresse'],
          ),
          deep(
            'Originalturm 1597–1602, 1914 gesprengt; Fundamente bei Ebbe unterhalb Neuer Leuchtturm. Nachbau 1932/33 auf 124 Pfählen.',
            ['geschichte', 'architecture'],
          ),
        ],
      );
    }
    const bistro = pack.spots.find((s) => /djh-bistro/i.test(s.name));
    if (bistro) {
      bistro.bullets = Array.from(
        new Set([
          ...(bistro.bullets || []),
          'Täglich 11:00–17:00: Snacks und Getränke auch für Spaziergänger auf der Sonnenterrasse (nicht nur Hausgäste).',
        ]),
      );
    }
  }

  // ─── Café Pudding: disentangled mid-trigger (no 1945 bombing) ──────
  {
    const spot = pack.spots.find((s) => s.id === 'wangerooge_cafe_pudding');
    if (spot) {
      const c = centroid(spot.polygonCoordinates);
      spot.approach_triggers = [
        approachAt(
          c.lat,
          c.lng,
          100,
          180,
          36,
          `${spot.id}_approach_far`,
          'Am Ende der Fußgängerzone, dort wo die Insel scheinbar ins Meer abbricht, siehst du einen markanten, runden Bau auf der Düne thronen. Das ist das legendäre Café Pudding.',
        ),
        approachAt(
          c.lat,
          c.lng,
          20,
          190,
          14,
          `${spot.id}_approach_mid`,
          'Kaum zu glauben, aber dieses helle, einladende Stück Inselarchitektur verbirgt in seinem Kern einen massiven Weltkriegsbunker der Wehrmacht. 1949 machte die Gründerfamilie Folkerts aus diesem unschönen militärischen Beton-Relikt ein süßes Symbol der zivilen Erholung.',
        ),
        approachAt(
          c.lat,
          c.lng,
          5,
          200,
          8,
          `${spot.id}_approach_near`,
          "Hier beginnt der 'Pudding'. Ob für hausgemachtes Eis oder ostfriesischen Tee – die Aussicht von dieser Düne auf die rollenden Wellen des Wattenmeers ist unvergleichlich. Beachte, dass montags Ruhetag herrscht.",
        ),
      ];
      // Ensure no Hartmannstand/1945 conflation in bullets
      spot.bullets = [
        'Adresse: Zedeliusstraße / Übergang Obere Strandpromenade.',
        'Runder Bau auf Promenadendüne umschließt Wehrmachtsbunker; Familie Folkerts startete 1948 mit Eis, Eröffnung Café Pudding 4. Juni 1949.',
        'Name: lokal „um den Pudding gehen“ = die Düne umrunden. Heute 4. Generation Folkerts.',
        'Di–So 11:00–21:30, Abendkarte 17:30–20:30; Montag Ruhetag. Eigene Eisherstellung & Konditorei.',
      ];
      spot.tags = Array.from(
        new Set([...(spot.tags || []), 'geschichte_entzerrt']),
      );
    }
  }

  // ─── Rosenhaus teasers (short v2) ──────────────────────────────────
  {
    const spot = pack.spots.find(
      (s) => s.id === 'wangerooge_nationalpark_haus_wangerooge',
    );
    if (spot) {
      const c = centroid(spot.polygonCoordinates);
      spot.approach_triggers = [
        approachAt(
          c.lat,
          c.lng,
          50,
          270,
          22,
          `${spot.id}_approach_far`,
          "Vor dir liegt das ökologische Herz der Insel: Das Nationalpark-Haus 'Rosenhaus'.",
        ),
        approachAt(
          c.lat,
          c.lng,
          15,
          280,
          12,
          `${spot.id}_approach_mid`,
          'Wirf einen Blick durch den Zaun in den Garten – dort ruht das gewaltige Knochengerüst eines gestrandeten Pottwals.',
        ),
        approachAt(
          c.lat,
          c.lng,
          5,
          290,
          8,
          `${spot.id}_approach_near`,
          'Der Eintritt in dieses Zentrum ist kostenfrei und die Architektur zu 100 % rollstuhlgerecht.',
        ),
      ];
    }
  }

  // ─── Reposition / rewrite micro-spots with GPS ─────────────────────
  const micros = [
    {
      id: 'wangerooge_hartmannstand_gedenken',
      name: 'Mahnmal Bunker Hartmannsstand',
      district: 'Nord',
      category: 'denkmal',
      lat: GPS.hartmann.lat,
      lng: GPS.hartmann.lng,
      halfM: 22,
      tags: ['denkmal', 'geschichte', 'krieg', 'sourced_gemini'],
      bullets: [
        `GPS: ${GPS.hartmann.lat}, ${GPS.hartmann.lng} — Holzkreuz in den Dünen am Hartmannsstand.`,
        'Gedenken an 311 Menschen, die am 25. April 1945 bei einem Bombenangriff in einem Bunker getötet wurden.',
        'Historisch getrennt vom Café-Pudding-Bunker (zivile Umnutzung) — hier reine Trauer und Mahnung.',
      ],
      facts: {
        origin:
          '25.04.1945: Bombenangriff, 311 Tote im Bunker am Hartmannsstand.',
        now: 'Holzkreuz-Mahnmal in den Dünen — stilles Gedenken, getrennt von der Pudding-Bunker-Erzählung.',
        tags: ['denkmal', 'geschichte', 'krieg'],
      },
      general:
        'Hartmannsstand: Mahnmal für 311 Opfer des 25. April 1945 — eigenständige Kriegsgeschichte, nicht mit Café Pudding vermengen.',
      deep: [
        deep(
          'GPS 53°47\'37.50"N 07°53\'31.70"E. 311 Tote am 25.04.1945. Strikte Trennung von der zivilen Bunker-Umwidmung am Café Pudding.',
          ['geschichte', 'krieg', 'denkmal'],
        ),
      ],
      teaser:
        'In den Dünen am Hartmannsstand steht ein Holzkreuz — Gedenken an 311 Menschen, die hier 1945 ums Leben kamen.',
    },
    {
      id: 'wangerooge_fundamente_alter_westturm',
      name: 'Fundamente Alter Westturm (Ebbe)',
      district: 'West',
      category: 'denkmal',
      lat: fundamente.lat,
      lng: fundamente.lng,
      halfM: 28,
      tags: ['denkmal', 'geschichte', 'ebbe', 'tide', 'sourced_gemini'],
      bullets: [
        'Bei Ebbe am Strand unterhalb des Neuen Leuchtturms: Überreste des 1602 erbauten und 1914 gesprengten Alten Westturms.',
        `Gemini lieferte GPS ${GPS.fundamente_gemini.lat}, ${GPS.fundamente_gemini.lng} — deckungsgleich mit heutigem Westturm; deshalb hier strandseitig am Neuen Leuchtturm verortet (Lost Place / Tide).`,
      ],
      facts: {
        origin: 'Alter Westturm 1597–1602, 1914 gesprengt; Fundamente nur bei Ebbe sichtbar.',
        now: 'Lost Place — am besten mit Tide-/Ebbe-Fenster ansteuern.',
        tags: ['denkmal', 'ebbe', 'tide'],
      },
      general:
        'Nur bei Ebbe sichtbar: Fundamente des historischen Westturms unterhalb des Neuen Leuchtturms.',
      deep: [
        deep(
          'Tide-abhängig. Ideal mit Gezeiten-API verknüpfen. Gemini-GPS kollidierte mit Westturm-Koordinaten — korrigierte Strandlage am Neuen LT.',
          ['ebbe', 'tide', 'geschichte'],
        ),
      ],
      teaser:
        'Bei Ebbe kannst du hier die Fundamentsteine des alten Westturms von 1602 entdecken — 1914 gesprengt.',
      condition: 'tide_low',
    },
    {
      id: 'wangerooge_st_willehad',
      name: 'St.-Willehad-Kirche & Mutter-Kind-Klinik',
      district: 'Ost',
      category: 'kirche',
      // Prefer Google Bootsweg 12 over Gemini DMS (different point)
      lat: GPS.willehad_bootsweg.lat,
      lng: GPS.willehad_bootsweg.lng,
      halfM: 25,
      tags: ['kirche', 'sourced_gemini'],
      bullets: [
        'Adresse: Bootsweg 12, 26486 Wangerooge — katholische St.-Willehad-Kirche & Mutter-Kind-Klinik.',
        `Google-Geocode Bootsweg 12; Gemini-DMS alternativ ${GPS.willehad_gemini.lat}, ${GPS.willehad_gemini.lng}.`,
      ],
      facts: {
        origin: 'Katholische Kirche St. Willehad am Bootsweg 12.',
        now: 'Kirche und Mutter-Kind-Klinik am selben Standortbereich.',
        tags: ['kirche'],
      },
      general:
        'St.-Willehad am Bootsweg — katholische Kirche und Mutter-Kind-Klinik.',
      deep: [
        deep(
          'Bootsweg 12. Sakralbau neben der evangelischen Nikolaikirche am Dorfplatz.',
          ['kirche'],
        ),
      ],
      teaser:
        'Vor dir: St.-Willehad — katholische Kirche und Mutter-Kind-Klinik am Bootsweg.',
    },
    {
      id: 'wangerooge_golfclub',
      name: 'Golfclub Insel Wangerooge',
      district: 'Ost',
      category: 'freizeit',
      lat: GPS.golf.lat,
      lng: GPS.golf.lng,
      halfM: 45,
      tags: ['freizeit', 'golf', 'sourced_gemini'],
      bullets: [
        'Adresse: Jadehörn 17 — Golfclub Insel Wangerooge e.V.',
        '9-Loch-Platz direkt in den Inselflugplatz integriert — deutschlandweit einmalig.',
      ],
      facts: {
        origin: 'Golfclub am Jadehörn 17, integriert in den Flugplatz.',
        now: '9 Löcher + Flugbetrieb auf demselben Gelände.',
        tags: ['freizeit', 'golf'],
      },
      general:
        'Golf und Flugplatz teilen sich Jadehörn — bundesweit einmaliges Konzept.',
      deep: [
        deep(
          'Jadehörn 17: 9-Loch-Platz architektonisch im Inselflugplatz.',
          ['freizeit', 'golf'],
        ),
      ],
      teaser:
        'Hier überlagern sich Golfgrün und Flugplatz — der 9-Loch-Platz des Golfclubs Insel Wangerooge.',
    },
    {
      id: 'wangerooge_diggers_aussenposten',
      name: "Digger's Außenposten",
      district: 'Nord',
      category: 'cafe',
      lat: offsetMeters(GPS.diggers_hq.lat, GPS.diggers_hq.lng, 5, 50).lat,
      lng: offsetMeters(GPS.diggers_hq.lat, GPS.diggers_hq.lng, 5, 50).lng,
      halfM: 16,
      tags: ['cafe', 'bar', 'sourced_gemini'],
      bullets: [
        'Ca. 50 m von Digger’s Strandbar (Obere Strandpromenade 3): Schirmbar mit Meerblick und Happy Hour.',
      ],
      facts: {
        origin: 'Outdoor-Ableger der Digger’s Strandbar an der Promenade.',
        now: 'Happy Hour und Schirmbar mit Meerblick.',
        tags: ['cafe', 'bar'],
      },
      general: 'Digger’s Außenposten: Outdoor-Drinks unter Schirmen, ~50 m vom HQ.',
      deep: [
        deep(
          '50 m von Obere Strandpromenade 3: Happy Hour, Schirmbar, Meerblick.',
          ['cafe', 'bar'],
        ),
      ],
      teaser:
        'Gleich voraus: Digger’s Außenposten — Schirmbar und Happy Hour mit Meerblick.',
    },
  ];

  for (const m of micros) {
    const approaches = [
      approachAt(
        m.lat,
        m.lng,
        35,
        180,
        16,
        `${m.id}_approach_1`,
        m.teaser,
      ),
    ];
    if (m.condition) approaches[0].condition_rule = m.condition;
    upsertSpot(
      pack,
      {
        id: m.id,
        name: m.name,
        district: m.district,
        category: m.category,
        tags: m.tags,
        bullets: m.bullets,
        facts: m.facts,
        polygonCoordinates: boxPolygon(m.lat, m.lng, m.halfM),
        approach_triggers: approaches,
        sub_pois: [],
      },
      m.general,
      m.deep,
    );
  }

  // ─── Emergency / everyday micro-spots ──────────────────────────────
  const emergency = [
    {
      id: 'wangerooge_polizei',
      name: 'Polizeistation Wangerooge',
      district: 'Dorf',
      category: 'sicherheit',
      lat: GPS.polizei.lat,
      lng: GPS.polizei.lng,
      bullets: [
        'Adresse: Charlottenstraße 9. Reguläre Polizeiwache Niedersachsen.',
        'Notruf 110 — lokal 04469-94690-0.',
      ],
      tags: ['sicherheit', 'polizei', 'sourced_gemini'],
      general: 'Polizeistation Charlottenstraße 9 — Notruf 110.',
      deep: [
        deep('Polizei Wangerooge, Charlottenstraße 9, Tel. 04469-94690-0.', [
          'sicherheit',
          'live',
        ]),
      ],
      teaser: 'Hier ist die Polizeistation Wangerooge — Notruf 110, lokal 04469-94690-0.',
    },
    {
      id: 'wangerooge_praxis_kortenhorn',
      name: 'Hausarztpraxis Dr. Kortenhorn',
      district: 'Dorf',
      category: 'gesundheit',
      lat: GPS.arzt.lat,
      lng: GPS.arzt.lng,
      bullets: [
        'Adresse: Robbenstraße 12 — Innere und Notfallmedizin.',
        'Tel. 04469-1700 mit automatisierter Rufweiterleitung zum diensthabenden Arzt außerhalb der Sprechstunden. Kein Krankenhaus auf der Insel — schwere Fälle per 112 (Heli/Seenot).',
      ],
      tags: ['gesundheit', 'notfall', 'sourced_gemini'],
      general:
        'Dr. Kortenhorn, Robbenstraße 12 — Notfallmedizin mit Rufweiterleitung 04469-1700.',
      deep: [
        deep(
          'Kein Krankenhaus auf Wangerooge. Praxis Robbenstraße 12, 04469-1700; Rettung 112.',
          ['gesundheit', 'notfall'],
        ),
      ],
      teaser:
        'Hausarztpraxis Dr. Kortenhorn (Robbenstraße 12) — Notfallnummer 04469-1700 mit Weiterleitung.',
    },
    {
      id: 'wangerooge_insel_apotheke',
      name: 'Insel-Apotheke',
      district: 'Dorf',
      category: 'gesundheit',
      lat: GPS.apotheke.lat,
      lng: GPS.apotheke.lng,
      bullets: [
        'Adresse: Zedeliusstraße 31 — primäre Medikamentenversorgung der Insel.',
      ],
      tags: ['gesundheit', 'apotheke', 'sourced_gemini'],
      general: 'Insel-Apotheke Zedeliusstraße 31.',
      deep: [
        deep('Insel-Apotheke, Zedeliusstraße 31.', ['gesundheit', 'live']),
      ],
      teaser: 'Zur Linken die Insel-Apotheke in der Zedeliusstraße 31.',
    },
    {
      id: 'wangerooge_lzo_geldautomat',
      name: 'LzO Geldautomat (barrierefrei)',
      district: 'Dorf',
      category: 'service',
      lat: GPS.lzo.lat,
      lng: GPS.lzo.lng,
      bullets: [
        'Adresse: Zedeliusstraße 34 — Landessparkasse zu Oldenburg SB-Filiale.',
        'Täglich 06:00–23:00, rollstuhlgerecht / barrierefrei.',
      ],
      tags: ['service', 'geld', 'barrierefreiheit', 'sourced_gemini'],
      general: 'LzO SB Zedeliusstraße 34 — 06–23 Uhr, barrierefrei.',
      deep: [
        deep(
          'LzO Zedeliusstraße 34, täglich 06:00–23:00, barrierefrei.',
          ['service', 'barrierefreiheit'],
        ),
      ],
      teaser:
        'Hier die barrierefreie LzO-SB-Filiale (Zedeliusstraße 34), geöffnet 06 bis 23 Uhr.',
    },
  ];

  for (const e of emergency) {
    upsertSpot(
      pack,
      {
        id: e.id,
        name: e.name,
        district: e.district,
        category: e.category,
        tags: e.tags,
        bullets: e.bullets,
        facts: {
          origin: e.bullets[0],
          now: e.bullets[1] || e.bullets[0],
          tags: e.tags,
        },
        polygonCoordinates: boxPolygon(e.lat, e.lng, 18),
        approach_triggers: [
          approachAt(e.lat, e.lng, 25, 180, 14, `${e.id}_approach_1`, e.teaser),
        ],
        sub_pois: [],
      },
      e.general,
      e.deep,
    );
  }

  // ─── Gastronomy 2026 prices ────────────────────────────────────────
  {
    const gerken = pack.spots.find((s) => /gerken/i.test(s.name));
    if (gerken) {
      gerken.bullets = [
        ...(gerken.bullets || []).filter((b) => !/büfett|buffet|27|38/i.test(b)),
        'Obere Strandpromenade 21 — Saison 2026: Frühstücksbüfett 27,00 € (auch externe Gäste), Abendbüfett ab 17:30 38,00 € regionale Küche.',
      ];
      gerken.tags = Array.from(
        new Set([...(gerken.tags || []), 'saison_2026', 'sourced_gemini']),
      );
    }
    const fisch = pack.spots.find((s) => /^Fischerstube$/i.test(s.name));
    if (fisch) {
      fisch.bullets = Array.from(
        new Set([
          ...(fisch.bullets || []),
          'Im Strandhotel Gerken: Tagesangebot 10:30–16:00 — Kibbelinge, Fischbrötchen, Inselbier; auch Online-Abholung.',
        ]),
      );
    }
    const digger = pack.spots.find((s) => /digger.?s.?strandbar/i.test(s.name));
    if (digger) {
      digger.bullets = Array.from(
        new Set([
          ...(digger.bullets || []).filter((b) => !/außenposten|aussenposten/i.test(b)),
          'Obere Strandpromenade 3: Surf-Ästhetik, eigener Gin, Palettenmöbel. Außenposten ~50 m weiter als eigener Spot.',
        ]),
      );
    }
  }

  // ─── Fähranleger island: point to Harlesiel + 2026 ──────────────────
  {
    const spot = pack.spots.find((s) => /fähranleger wangerooge/i.test(s.name));
    if (spot) {
      spot.bullets = [
        'Insel-Fähranleger Südwest — Anschluss an die Schmalspur-Inselbahn Richtung Bahnhof.',
        'Gepäck-Aufgabe erfolgt in Harlesiel (Pre-Start-Spot), nicht hier. West-Gäste: Hauszustellung.',
        'Tarife Saison 2026 siehe Spot „Fährhafen Harlesiel“.',
      ];
      spot.tags = Array.from(
        new Set([...(spot.tags || []), 'saison_2026', 'harlesiel_linked']),
      );
    }
  }

  // Strip Kurverwaltung duplicate emergency walls of text if present — keep lighter
  {
    const kur = pack.spots.find((s) => /kurverwaltung|erholung ist eine/i.test(s.name));
    if (kur) {
      kur.bullets = (kur.bullets || []).filter(
        (b) =>
          !/Polizei Charlotten|Dr\. Kortenhorn|Insel-Apotheke Zedelius|LzO SB/i.test(
            b,
          ),
      );
      kur.bullets.push(
        'Notfall- und Alltags-Micro-Spots: Polizei, Praxis Kortenhorn, Insel-Apotheke, LzO — jeweils eigene Koordinaten.',
        'WLAN: #free_inselwlan; Vodafone ~240 Hotspots; Freifunk 8 Knoten. Strandbuggys an der Pudding-Uhr.',
      );
    }
  }

  if (!pack.district_division.includes('Festland')) {
    pack.district_division = ['Festland', ...pack.district_division];
  }

  pack.data_version = 6;
  pack._build = {
    ...(pack._build || {}),
    gemini_refine_v2: {
      at: new Date().toISOString(),
      season_tariffs: 2026,
      harlesiel_spot: 'harlesiel_faehrhafen',
      notes: [
        'Harlesiel als Mainland-Pre-Start im Wangerooge-Pack (district Festland).',
        'Fundamente-GPS von Gemini deckungsgleich mit Westturm → strandseitig am Neuen Leuchtturm korrigiert; bitte Gemini bestätigen.',
        'St.-Willehad: Bootsweg 12 via Google Geocode (Gemini-DMS weicht ab).',
        'Café Pudding vs Hartmannsstand historisch entzerrt.',
        'Westturm-Adresse: Im Westen 38 (offiziell).',
        'Tide-API für Fundamente noch nicht verdrahtet (condition_rule tide_low gesetzt).',
      ],
    },
  };

  fs.writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2));
  const v = validateCityPack(pack);
  console.log(
    JSON.stringify(
      {
        spots: pack.spots.length,
        version: pack.data_version,
        harlesiel: !!pack.spots.find((s) => s.id === 'harlesiel_faehrhafen'),
        approaches: pack.spots.reduce(
          (n, s) => n + (s.approach_triggers || []).length,
          0,
        ),
        validate: v,
        fundamente: pack.spots.find(
          (s) => s.id === 'wangerooge_fundamente_alter_westturm',
        )
          ? centroid(
              pack.spots.find(
                (s) => s.id === 'wangerooge_fundamente_alter_westturm',
              ).polygonCoordinates,
            )
          : null,
        hartmann: GPS.hartmann,
      },
      null,
      2,
    ),
  );
}

main();
