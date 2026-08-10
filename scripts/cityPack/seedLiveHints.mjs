#!/usr/bin/env node
/**
 * Seed stable LIVE: hints on spots that typically have ephemeral content.
 * Does not invent prices/events — only search instructions.
 *
 *   node scripts/cityPack/seedLiveHints.mjs --city wangerooge --apply
 */

import {
  arg,
  hasFlag,
  isEphemeralCategory,
  loadPack,
  savePack,
  triggerForSpot,
} from './lib.mjs';

const HINTS_BY_CAT = {
  restaurant: [
    {
      text: 'LIVE: Speisekarte — aktuell im Web suchen und gültigen Link finden; Preise nie aus dem Pack vorlesen.',
      tags: ['live_hint', 'gastro', 'ephemeral'],
    },
    {
      text: 'LIVE: Öffnungszeiten & Ruhetag — heute verifizieren.',
      tags: ['live_hint', 'ephemeral'],
    },
  ],
  fischrestaurant: [
    {
      text: 'LIVE: Speisekarte — aktuell suchen; Preise nie aus dem Pack vorlesen.',
      tags: ['live_hint', 'gastro', 'ephemeral'],
    },
  ],
  cafe: [
    {
      text: 'LIVE: Speise-/Getränkekarte und heutige Öffnungszeiten frisch suchen.',
      tags: ['live_hint', 'gastro', 'ephemeral'],
    },
  ],
  hotel: [
    {
      text: 'LIVE: Verfügbarkeit & Preise für das Reisedatum frisch suchen — keine Pack-Preise.',
      tags: ['live_hint', 'hotels', 'ephemeral'],
    },
  ],
  museum: [
    {
      text: 'LIVE: Aktuelle Ausstellung / Programm / Tickets recherchieren falls der User danach fragt.',
      tags: ['live_hint', 'events', 'ephemeral'],
    },
  ],
  freizeit: [
    {
      text: 'LIVE: Touren, Tickets oder heutige Events zu diesem Ort frisch recherchieren.',
      tags: ['live_hint', 'tours', 'ephemeral'],
    },
  ],
  sport: [
    {
      text: 'LIVE: Aktuelle Öffnungszeiten / Platzbuchung frisch prüfen.',
      tags: ['live_hint', 'ephemeral'],
    },
  ],
  kirche: [
    {
      text: 'LIVE: Gottesdienst-/Konzerttermine nur live suchen, nicht aus dem Pack behaupten.',
      tags: ['live_hint', 'events', 'ephemeral'],
    },
  ],
};

function catOf(spot) {
  return String(spot.category || spot.district || '').toLowerCase();
}

function main() {
  const cityId = arg('city');
  if (!cityId) {
    console.error('Usage: node scripts/cityPack/seedLiveHints.mjs --city <id> [--apply]');
    process.exit(1);
  }
  const apply = hasFlag('apply');
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack not found: ${cityId}`);

  let added = 0;
  for (const spot of pack.spots || []) {
    const cat = catOf(spot);
    let hints = HINTS_BY_CAT[cat];
    if (!hints && isEphemeralCategory(cat)) {
      hints = HINTS_BY_CAT.restaurant;
    }
    // Generic event-ish names
    if (
      !hints &&
      /goldschätzchen|theater|kurhaus|kurplatz|konzert|festival/i.test(spot.name)
    ) {
      hints = [
        {
          text: 'LIVE: Events/Programm an diesem Ort — heutige und kommende Termine frisch recherchieren.',
          tags: ['live_hint', 'events', 'ephemeral'],
        },
      ];
    }
    if (!hints) continue;

    const t = triggerForSpot(pack, spot);
    if (!t) continue;
    t.deep_data_pool = t.deep_data_pool || [];
    for (const h of hints) {
      const key = h.text.toLowerCase().slice(0, 60);
      if (
        t.deep_data_pool.some((e) =>
          String(typeof e === 'string' ? e : e?.text || '')
            .toLowerCase()
            .includes(key.slice(0, 40)),
        )
      ) {
        continue;
      }
      t.deep_data_pool.push(h);
      added += 1;
    }
  }

  console.log(`[live-hints] would add ${added} hints to ${cityId}`);
  if (apply) {
    const file = savePack(pack, { bumpVersion: true });
    console.log(`[live-hints] wrote ${file}`);
  }
}

main();
