/**
 * Run: npx --yes tsx src/services/ui/weatherDayPlanSpeech.smoke.test.ts
 */

import {
  formatEmptyPlanInvite,
  formatWeatherChat,
  formatWeatherBriefing,
  formatWeatherBullets,
  formatTomorrowWeatherChat,
  formatWeatherPresentation,
  formatWeatherVoiceAnswer,
  weatherOkOutdoorFromSnap,
  pickInvitePlaceNames,
} from './weatherDayPlanSpeech';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const talk = formatWeatherChat({
  snap: {
    currentTempC: 14,
    dayHighC: 22,
    precipitationMm: 0,
    nextRainProb: 10,
    summaryLine: 'Aktuell 14°',
  },
  heavy: false,
  soon: false,
});
assert(/14/.test(talk), 'jetzt-Temperatur');
assert(/22/.test(talk), 'Tageshoch');
assert(/trocken/i.test(talk), 'Regenstärke: trocken');
assert(!/nichts festgehalten/i.test(talk), 'kein Disclaimer im Wetter');

const heavy = formatWeatherChat({
  snap: { currentTempC: 14, isHeavyRain: true, precipitationMm: 4 },
  heavy: true,
  soon: true,
});
assert(/nass/i.test(heavy), 'Starkregen als Stärke');

const board = formatWeatherBullets({
  currentTempC: 14,
  dayHighC: 17,
  nextRainProb: 70,
  nextRainAtMs: Date.parse('2026-08-23T16:00:00'),
  precipitationMm: 0.2,
});
assert(board.length >= 2 && board.length <= 3, `weather board 2–3, got ${board.length}`);
assert(board.some((b) => /14|17/.test(b)), `temp in bullets: ${board.join(' | ')}`);
assert(board.some((b) => /jacke|lage|luft|schicht/i.test(b)), `clothing tip: ${board.join(' | ')}`);
assert(board.every((b) => !b.endsWith('…')), 'no 48-char clip fragments');
assert(board.every((b) => !/^t bis /i.test(b)), 'no mid-word clip');

const tom = formatTomorrowWeatherChat({
  tomorrowSummary: '13–24°, Wolken und Sonne, Regenrisiko 40%',
});
assert(/13|24|Grad/i.test(tom.speech), 'morgen speech temp');
assert(/kleidung|jacke|lage|locker/i.test(tom.speech), 'morgen clothing tip');
assert(tom.bullets.length === 3, 'morgen 3 bullets');
assert(tom.bullets.some((b) => /wolken|sonne/i.test(b)), 'morgen sky bullet');
assert(tom.bullets.some((b) => /13|24/.test(b)), 'morgen temp bullet');
assert(!/aushang|brett|bahnhof/i.test(tom.speech), 'kein Aushang');
assert(
  weatherOkOutdoorFromSnap({
    currentTempC: 14,
    nextRainProb: 70,
    precipitationMm: 0.2,
  }) === false,
  'showers → not outdoor-ok',
);
assert(
  weatherOkOutdoorFromSnap({
    currentTempC: 22,
    dayHighC: 24,
    nextRainProb: 10,
    precipitationMm: 0,
  }) === true,
  'dry mild → outdoor-ok',
);

const invite = formatEmptyPlanInvite(
  ['Planten un Blomen', 'Miniatur Wunderland'],
  false,
);
assert(/Planten un Blomen/.test(invite), 'konkreter Ort A');
assert(/Miniatur Wunderland/.test(invite), 'konkreter Ort B');
assert(!/nichts festgehalten/i.test(invite), 'kein Meta-Disclaimer');
assert(!/nur ideen/i.test(invite), 'kein „nur Ideen“');

const indoor = formatEmptyPlanInvite(['Kunsthalle', 'Café Paris'], true);
assert(/drinnen/i.test(indoor), 'Regen → drinnen');

const pois = [
  {
    name: 'Planten un Blomen',
    lat: 53.56,
    lng: 9.98,
    tags_json: JSON.stringify(['story']),
    category: 'park',
    kind: 'area',
  },
  {
    name: 'Kunsthalle',
    lat: 53.55,
    lng: 10.0,
    tags_json: JSON.stringify(['story']),
    category: 'museum',
    kind: 'area',
  },
  {
    name: 'Hotel Dummy',
    lat: 53.55,
    lng: 9.99,
    tags_json: JSON.stringify(['story']),
    category: 'hotel',
    kind: 'area',
  },
];

const dryPick = pickInvitePlaceNames({
  rainy: false,
  lat: 53.55,
  lng: 9.99,
  pois,
});
assert(dryPick.includes('Planten un Blomen'), 'trocken: Park');
assert(!dryPick.includes('Hotel Dummy'), 'kein Hotel');

const rainPick = pickInvitePlaceNames({
  rainy: true,
  lat: 53.55,
  lng: 9.99,
  pois,
});
assert(rainPick[0] === 'Kunsthalle', 'Regen: Museum zuerst');

const snapFull = {
  currentTempC: 14,
  dayHighC: 22,
  nightLowC: 11,
  weatherCode: 2,
  nextRainProb: 20,
  precipitationMm: 0,
  tomorrowSummary: '13–24°, leicht bewölkt',
  sunsetMs: Date.parse('2026-08-23T20:33:00'),
};

const morning = formatWeatherBriefing({
  snap: snapFull,
  heavy: false,
  soon: false,
  nowMs: Date.parse('2026-08-23T08:30:00'),
});
assert(/14/.test(morning.speech), 'Vormittag: jetzt');
assert(/22/.test(morning.speech), 'Vormittag: Hoch');
assert(/Kleidung|Jacke|Lage|Outfit/i.test(morning.speech), 'bis 11 Uhr Outfit');
assert(!/Morgen:/i.test(morning.speech), 'vormittags kein Morgen-Block');

const noon = formatWeatherBriefing({
  snap: snapFull,
  heavy: false,
  soon: false,
  nowMs: Date.parse('2026-08-23T12:00:00'),
});
assert(!/Outfit/i.test(noon.speech), 'ab 11 Uhr kein Outfit');
assert(!/Morgen:/i.test(noon.speech), 'mittags kein Morgen-Block');
assert(/Nacht|11/.test(noon.speech), 'nach 12 Uhr Nacht-Tief');

const evening = formatWeatherBriefing({
  snap: snapFull,
  heavy: false,
  soon: false,
  nowMs: Date.parse('2026-08-23T16:10:00'),
});
assert(/Morgen/i.test(evening.speech), 'ab 16 Uhr morgen');
assert(/13–24/.test(evening.speech), 'Morgen-Zahlen nur belegt');
assert(!/Outfit/i.test(evening.speech), 'nachmittags kein Outfit');

const eleven = formatWeatherBriefing({
  snap: snapFull,
  heavy: false,
  soon: false,
  nowMs: Date.parse('2026-08-23T11:00:00'),
});
assert(!/Outfit/i.test(eleven.speech), '11 Uhr: Outfit-Fenster zu');

const rainy = formatWeatherVoiceAnswer({
  snap: {
    currentTempC: 17,
    dayHighC: 22,
    nextRainProb: 91,
    weatherCode: 520,
    rainWindows: [
      {
        startMs: Date.parse('2026-08-23T14:00:00'),
        endMs: Date.parse('2026-08-23T18:00:00'),
        pop: 91,
      },
    ],
  },
  cityHint: 'Hamburg',
  nowMs: Date.parse('2026-08-23T09:00:00'),
});
assert(/Hamburg/i.test(rainy.speech), 'city in speech');
assert(!/\d{2}\s*%|Prozent/i.test(rainy.speech), 'no percent dump in speech');
assert(/Regen|nass|Schauer|Schirm|Jacke/i.test(rainy.speech), 'rain story');
assert(/17.*22|22.*17|liegst du bei 17/.test(rainy.speech), 'temp range');
assert(/Regenfest|regenfest|Schirm/i.test(rainy.speech), 'rain gear');
assert(/14:00|trocken/i.test(rainy.speech), 'dry window or rain time');

const pres = formatWeatherVoiceAnswer({
  snap: snapFull,
  cityHint: 'Hamburg',
});
assert(pres.speech.length > 20, 'weather speech');
assert(/Hamburg|Regen|Grad/i.test(pres.speech), 'rich weather voice');
assert(pres.bullets.some((b) => /\d/.test(b)), 'bullets have digits');
assert(!pres.bullets.some((b) => /^wetter heute$/i.test(b)), 'no Wetter heute bullet');

{
  const withTimeline = formatWeatherVoiceAnswer({
    snap: {
      currentTempC: 17,
      dayHighC: 22,
      nextRainProb: 85,
      nextRainAtMs: Date.parse('2026-08-23T16:00:00'),
      weatherCode: 520,
      rainWindows: [
        {
          startMs: Date.parse('2026-08-23T16:00:00'),
          endMs: Date.parse('2026-08-23T19:00:00'),
          pop: 85,
        },
      ],
    },
    cityHint: 'Hamburg',
    nowMs: Date.parse('2026-08-23T09:00:00'),
    timelineHints: [
      "Bis Mittagessen gegen 13:00 reicht's trocken — danach pack ich lieber Schirm oder Regenjacke ein.",
      'Picknick draußen ab 14:00 passt wettertechnisch schlecht — Regen kreuzt da. Sollen wir vorziehen oder nach drinnen verlegen?',
    ],
  });
  assert(/Picknick|Mittagessen|Schirm/i.test(withTimeline.speech), 'timeline woven into voice');
}

{
  const early = formatWeatherVoiceAnswer({
    snap: {
      currentTempC: 8,
      dayHighC: 19,
      nextRainProb: 40,
      weatherCode: 803,
      rainWindows: [
        {
          startMs: Date.parse('2026-08-28T05:00:00'),
          endMs: Date.parse('2026-08-28T07:00:00'),
          pop: 60,
        },
        {
          startMs: Date.parse('2026-08-28T14:00:00'),
          endMs: Date.parse('2026-08-28T17:00:00'),
          pop: 70,
        },
      ],
    },
    cityHint: 'Hamburg',
    nowMs: Date.parse('2026-08-28T03:45:00'),
    userText: 'Wie wird das Wetter heute?',
  });
  assert(/tagsüber|Heute/i.test(early.speech), 'early morning day-ahead lead');
  assert(!/liegst du bei 8|Gerade liegst/i.test(early.speech), 'no 3am snap focus');
  assert(!/05:00|5:00/.test(early.speech), 'no pre-dawn rain window');
  assert(/14:00|Regen/i.test(early.speech), 'daytime rain kept');
}

{
  const athen = formatWeatherVoiceAnswer({
    snap: { currentTempC: 22, dayHighC: 28, weatherCode: 800, nextRainProb: 10 },
    cityHint: 'Athen',
    namedCity: true,
    userText: 'Wie ist das Wetter in Athen?',
  });
  assert(/In Athen/i.test(athen.speech), 'named city phrasing');
  assert(!/liegst du bei/i.test(athen.speech), 'no GPS liegst du');
}

{
  const { resolveWeatherPlaceTarget } = require('./weatherDayPlanSpeech') as {
    resolveWeatherPlaceTarget: (
      t: string,
      h?: string | null,
    ) => { city: string | null; namedCity: boolean; useGps: boolean };
  };
  const { noteMentionedCity, clearLastMentionedCity } = require('../../module2/context/shortTermContext') as {
    noteMentionedCity: (c: string) => void;
    clearLastMentionedCity: () => void;
  };
  clearLastMentionedCity();
  noteMentionedCity('Athen');
  const ctx = resolveWeatherPlaceTarget('Wie ist das Wetter?', null);
  assert(ctx.city === 'Athen' && ctx.namedCity && !ctx.useGps, 'sticky Athen for bare weather');
  const hier = resolveWeatherPlaceTarget('Wie ist aktuell das Wetter hier?', null);
  assert(hier.useGps && !hier.namedCity, 'hier forces GPS');
  const expl = resolveWeatherPlaceTarget('Wetter in Hamburg', null);
  assert(expl.city === 'Hamburg' && expl.namedCity, 'explicit Hamburg');
  clearLastMentionedCity();
}

{
  const { keepCityStickyForFollowUp } = require('../../module2/context/cityChatScope') as {
    keepCityStickyForFollowUp: (s: string) => boolean;
  };
  assert(keepCityStickyForFollowUp('Wie ist das Wetter?'), 'weather keeps sticky');
  assert(!keepCityStickyForFollowUp('Wie ist das Wetter hier?'), 'hier does not keep sticky via weather rule alone');
}

console.log('weatherDayPlanSpeech.smoke.test.ts OK');

{
  const briefRain = formatWeatherBriefing({
    snap: {
      currentTempC: 18,
      dayHighC: 21,
      weatherCode: 801,
      nextRainProb: 78,
      rainWindows: [
        {
          startMs: Date.parse('2026-08-23T23:00:00'),
          endMs: Date.parse('2026-08-24T01:00:00'),
          pop: 78,
        },
        {
          startMs: Date.parse('2026-08-24T01:00:00'),
          endMs: Date.parse('2026-08-24T03:00:00'),
          pop: 60,
        },
      ],
    },
    heavy: false,
    soon: true,
    nowMs: Date.parse('2026-08-23T12:00:00'),
  });
  assert(/Aktuell|Grad/i.test(briefRain.speech), 'briefing opener');
  assert(!/Regenfenster/i.test(briefRain.speech), 'no Regenfenster jargon');
  assert(!/\d+\s*%|Prozent/i.test(briefRain.speech), 'no percent in briefing');
  assert((briefRain.speech.match(/\bheute\b/gi) || []).length <= 1, 'max one heute');
}
