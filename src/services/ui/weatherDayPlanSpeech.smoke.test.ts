/**
 * Run: npx --yes tsx src/services/ui/weatherDayPlanSpeech.smoke.test.ts
 */

import {
  formatEmptyPlanInvite,
  formatWeatherChat,
  formatWeatherBriefing,
  formatWeatherBullets,
  formatWeatherHudCard,
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
    sunsetMs: Date.parse('2026-08-23T20:33:00'),
    sunriseMs: Date.parse('2026-08-23T06:10:00'),
  },
  heavy: false,
  soon: false,
  nowMs: Date.parse('2026-08-23T10:00:00'),
});
assert(/14/.test(talk), 'jetzt-Temperatur');
assert(/22/.test(talk), 'Tageshoch');
assert(/trocken/i.test(talk), 'Regenstärke: trocken');
assert(!/nichts festgehalten/i.test(talk), 'kein Disclaimer im Wetter');
assert(!/\([^)]*jacke[^)]*\)/i.test(talk), 'kleidung nicht in klammern');

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

const hudFar = formatWeatherHudCard({
  snap: {
    currentTempC: 15,
    dayHighC: 18,
    precipitationMm: 0,
    nextRainAtMs: Date.parse('2026-08-23T15:00:00'),
    rainEndsAtMs: Date.parse('2026-08-23T15:30:00'),
    weatherCode: 800,
  },
  nowMs: Date.parse('2026-08-23T12:00:00'),
});
assert(hudFar?.title === '🌧 Regen ab 15 Uhr', `far rain title: ${hudFar?.title}`);
assert(
  hudFar?.meta === 'bis zu Temperaturen von 18 Grad',
  `far rain meta expanded: ${hudFar?.meta}`,
);
assert(!/15°/.test(hudFar?.title ?? ''), 'no current ° beside Regen ab');

const hudSoon = formatWeatherHudCard({
  snap: {
    currentTempC: 15,
    dayHighC: 18,
    precipitationMm: 0,
    nextRainAtMs: Date.parse('2026-08-23T12:45:00'),
    rainEndsAtMs: Date.parse('2026-08-23T13:25:00'),
    weatherCode: 800,
  },
  nowMs: Date.parse('2026-08-23T12:00:00'),
});
assert(
  hudSoon?.title === '🌧 Regen in ~45 Min · Dauer ca. 40 Min',
  `soon rain title: ${hudSoon?.title}`,
);
assert(
  hudSoon?.meta === 'bis zu Temperaturen von 18 Grad',
  `soon rain meta: ${hudSoon?.meta}`,
);

const hudNow = formatWeatherHudCard({
  snap: {
    currentTempC: 14,
    dayHighC: 16,
    precipitationMm: 0.8,
    rainEndsAtMs: Date.parse('2026-08-23T12:35:00'),
    weatherCode: 501,
  },
  nowMs: Date.parse('2026-08-23T12:00:00'),
});
assert(hudNow?.title === '🌧 Regen noch 35 Min', `falling title: ${hudNow?.title}`);

const hudHeavy = formatWeatherHudCard({
  snap: {
    currentTempC: 12,
    dayHighC: 14,
    precipitationMm: 4,
    isHeavyRain: true,
    rainEndsAtMs: Date.parse('2026-08-23T12:20:00'),
    weatherCode: 502,
  },
  nowMs: Date.parse('2026-08-23T12:00:00'),
});
assert(
  hudHeavy?.title === '🌧 Starker Regen noch 20 Min',
  `heavy falling: ${hudHeavy?.title}`,
);
assert(!/Jacke|Indoor|Schirm/i.test(hudHeavy?.meta ?? ''), 'no advice in rain meta');

assert(
  hudNow?.meta === 'bis zu Temperaturen von 16 Grad',
  `falling meta: ${hudNow?.meta}`,
);

// Nachts: Mond/Sternenhimmel, kein Sonnen-Emoji, kein Tageshoch, Regen = morgen.
const hudNight = formatWeatherHudCard({
  snap: {
    currentTempC: 16,
    dayHighC: 18,
    nightLowC: 12,
    precipitationMm: 0,
    weatherCode: 804,
    sunsetMs: Date.parse('2026-09-02T19:45:00'),
    sunriseMs: Date.parse('2026-09-03T06:40:00'),
    rainWindows: [
      {
        startMs: Date.parse('2026-09-03T08:00:00'),
        endMs: Date.parse('2026-09-03T10:00:00'),
        pop: 0.7,
      },
    ],
  },
  nowMs: Date.parse('2026-09-02T23:28:00'),
});
assert(hudNight?.title === '☁️ Bewölkt · 16°', `night cloudy title: ${hudNight?.title}`);
assert(
  !hudNight?.title.includes('\u2600') && !hudNight?.title.includes('⛅'),
  'no sun emoji at night',
);
assert(
  hudNight?.meta === 'Nacht um 12° · Regen ab 8 Uhr morgen',
  `night meta: ${hudNight?.meta}`,
);

const hudStars = formatWeatherHudCard({
  snap: {
    currentTempC: 11,
    dayHighC: 20,
    weatherCode: 800,
    sunsetMs: Date.parse('2026-09-02T19:45:00'),
    sunriseMs: Date.parse('2026-09-03T06:40:00'),
  },
  nowMs: Date.parse('2026-09-02T23:00:00'),
});
assert(
  hudStars?.title === '🌙 Sternenhimmel · 11°',
  `clear night: ${hudStars?.title}`,
);

const tom = formatTomorrowWeatherChat({
  tomorrowSummary: '13–24°, Wolken und Sonne, Regenrisiko 40%',
});
assert(/13|24|Grad/i.test(tom.speech), 'morgen speech temp');
assert(/morgen eher|höchstwerte|wolken/i.test(tom.speech), 'morgen knapper Hauptsatz');
assert(tom.speech.split(/[.!?]+/).filter((s) => s.trim()).length <= 2, 'morgen max 2 sätze');
assert(!/erwartet dich|schau nach|also das wetter/i.test(tom.speech), 'kein Opener-Essay');
assert(tom.bullets.length >= 2 && tom.bullets.length <= 4, `morgen chips 2–4, got ${tom.bullets.length}`);
assert(tom.bullets.some((b) => /wolken|sonne|tagesüber/i.test(b)), 'morgen sky bullet');
assert(tom.bullets.some((b) => /13|24/.test(b)), 'morgen temp bullet');
assert(
  tom.bullets.some((b) => /jacke|schirm|kleidung|lage|pulli/i.test(b)),
  'morgen clothing chip',
);
assert(!/aushang|brett|bahnhof/i.test(tom.speech), 'kein Aushang');

const tomDry = formatTomorrowWeatherChat({
  tomorrowSummary: '19–25°, bewölkt, Regenrisiko 10%',
});
assert(/19|25/i.test(tomDry.speech), 'dry temp');
assert(/morgen eher|bewölkt|höchstwerte/i.test(tomDry.speech), 'dry lead');
assert(
  tomDry.bullets.some((b) => /trocken|bewölkt|tagesüber/i.test(b)),
  'dry chip',
);
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
  sunriseMs: Date.parse('2026-08-23T06:10:00'),
};

const morning = formatWeatherBriefing({
  snap: snapFull,
  heavy: false,
  soon: false,
  nowMs: Date.parse('2026-08-23T08:30:00'),
});
assert(/14/.test(morning.speech), 'Vormittag: jetzt');
assert(/22/.test(morning.speech), 'Vormittag: Hoch');
assert(/Kleidung|Jacke|Lage|Outfit|Am besten/i.test(morning.speech), 'bis 11 Uhr Outfit');
assert(!/\([^)]*(?:jacke|lage|outfit)[^)]*\)/i.test(morning.speech), 'kein Outfit in Klammern');
assert(!/Morgen:/i.test(morning.speech), 'vormittags kein Morgen-Block');

const noon = formatWeatherBriefing({
  snap: snapFull,
  heavy: false,
  soon: false,
  nowMs: Date.parse('2026-08-23T12:00:00'),
});
assert(!/Outfit|Am besten/i.test(noon.speech), 'ab 11 Uhr kein Outfit');
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
assert(!/Outfit|Am besten/i.test(evening.speech), 'nachmittags kein Outfit');

const eleven = formatWeatherBriefing({
  snap: snapFull,
  heavy: false,
  soon: false,
  nowMs: Date.parse('2026-08-23T11:00:00'),
});
assert(!/Outfit|Am besten/i.test(eleven.speech), '11 Uhr: Outfit-Fenster zu');

{
  const nightClear = formatWeatherVoiceAnswer({
    snap: {
      currentTempC: 12,
      dayHighC: 22,
      weatherCode: 800,
      nextRainProb: 5,
      sunsetMs: Date.parse('2026-08-23T20:33:00'),
      sunriseMs: Date.parse('2026-08-23T06:10:00'),
    },
    cityHint: 'Prisdorf',
    nowMs: Date.parse('2026-08-23T22:15:00'),
    settlementHint: 'rural',
  });
  assert(/klarer himmel/i.test(nightClear.speech), 'nacht klar ohne Sonne-Wort');
  assert(!/\bsonne\b|sonnig|Sonnenschein/i.test(nightClear.speech), 'keine Sonne nach Sunset');
  assert(/sterne/i.test(nightClear.speech), 'Sterne Dorf/Land wenn klar');
}

{
  const nightUrban = formatWeatherVoiceAnswer({
    snap: {
      currentTempC: 14,
      weatherCode: 800,
      nextRainProb: 0,
      sunsetMs: Date.parse('2026-08-23T20:33:00'),
      sunriseMs: Date.parse('2026-08-23T06:10:00'),
    },
    cityHint: 'Hamburg',
    nowMs: Date.parse('2026-08-23T23:00:00'),
    settlementHint: 'urban',
  });
  assert(!/\bsonne\b|sonnig/i.test(nightUrban.speech), 'stadt nacht keine sonne');
  assert(/stadt|kaum/i.test(nightUrban.speech), 'stadt sterne ehrlich');
}

{
  const { unwrapClothingParentheses } = require('./weatherDayPlanSpeech') as {
    unwrapClothingParentheses: (s: string) => string;
  };
  const fixed = unwrapClothingParentheses(
    'Aktuell 14 Grad und trocken (leichte Jacke mitnehmen).',
  );
  assert(!/\(/.test(fixed), 'klammern weg');
  assert(/jacke/i.test(fixed), 'kleidung bleibt im fließtext');
}

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
  namedCity: true,
  nowMs: Date.parse('2026-08-23T09:00:00'),
  userText: 'Wie wird das Wetter heute in Hamburg?',
});
assert(/Hamburg/i.test(rainy.speech), 'city in speech');
assert(!/\d{2}\s*%|Prozent/i.test(rainy.speech), 'no percent dump in speech');
assert(/Regen|nass|Schauer|nachmittag|später/i.test(rainy.speech), 'rain story');
assert(/17|22|Grad|tagsüber/i.test(rainy.speech), 'temp range');
assert(
  rainy.bullets.some((b) => /schirm|jacke/i.test(b)),
  'rain gear chip',
);
assert(/14:00|14 Uhr|Regen/i.test(rainy.speech + rainy.bullets.join(' ')), 'rain time');
assert(rainy.speech.split(/[.!?]+/).filter((s) => s.trim()).length <= 2, 'max 2 sätze');
assert(!/also,|kurz zum wetter|schaue nach/i.test(rainy.speech), 'kein Opener');

const pres = formatWeatherVoiceAnswer({
  snap: snapFull,
  cityHint: 'Hamburg',
  namedCity: true,
});
assert(pres.speech.length > 20, 'weather speech');
assert(/Hamburg|Regen|Grad|tagsüber|gerade/i.test(pres.speech), 'rich weather voice');
assert(pres.bullets.some((b) => /\d/.test(b)), 'bullets have digits');
assert(pres.bullets.length >= 2 && pres.bullets.length <= 4, '2–4 chips');
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
      'Picknick draußen ab 14:00 und Regen — das beißt sich. Besser vorziehen oder kurz Indoor.',
    ],
  });
  assert(/Picknick|Indoor|vorziehen/i.test(withTimeline.speech), 'timeline conflict woven into voice');
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
  assert(/tagesüber|tagsüber|Heute/i.test(early.speech), 'early morning day-ahead lead');
  assert(!/liegst du bei 8|Gerade liegst/i.test(early.speech), 'no 3am snap focus');
  assert(!/05:00|5:00/.test(early.speech), 'no pre-dawn rain window');
  assert(/14:00|14 Uhr|Regen/i.test(early.speech), 'daytime rain kept');
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
  assert(ctx.useGps && !ctx.namedCity, 'bare weather → GPS (not sticky)');
  const da = resolveWeatherPlaceTarget('Wie ist das Wetter da aktuell?', null);
  assert(da.city === 'Athen' && da.namedCity && !da.useGps, 'da → sticky Athen');
  const dort = resolveWeatherPlaceTarget('Wie ist das Wetter dort?', null);
  assert(dort.city === 'Athen' && dort.namedCity, 'dort → sticky');
  const hier = resolveWeatherPlaceTarget('Wie ist aktuell das Wetter hier?', null);
  assert(hier.useGps && !hier.namedCity, 'hier forces GPS');
  const expl = resolveWeatherPlaceTarget('Wetter in Hamburg', null);
  assert(expl.city === 'Hamburg' && expl.namedCity, 'explicit Hamburg');
  const london = resolveWeatherPlaceTarget('Wie ist das Wetter in London?', null);
  assert(london.city === 'London' && london.namedCity, 'explicit London');
  clearLastMentionedCity();
}

{
  const { keepCityStickyForFollowUp } = require('../../module2/context/cityChatScope') as {
    keepCityStickyForFollowUp: (s: string) => boolean;
  };
  assert(!keepCityStickyForFollowUp('Wie ist das Wetter?'), 'bare weather does not keep sticky');
  assert(keepCityStickyForFollowUp('Wie ist das Wetter da?'), 'da keeps sticky');
  assert(!keepCityStickyForFollowUp('Wie ist das Wetter hier?'), 'hier does not keep sticky via weather rule alone');
}

{
  const radio = formatWeatherVoiceAnswer({
    snap: {
      currentTempC: 14,
      dayHighC: 18,
      nextRainProb: 35,
      weatherCode: 804,
      tomorrowSummary: '13–18°, Wolken und Sonne, Regenrisiko 55%',
      day2Summary: '11–17°, bewölkt, Regenrisiko 60%',
      windSpeedMs: 9,
      windGustMs: 14,
      skyHours: (() => {
        const base = new Date(Date.parse('2026-09-17T10:00:00'));
        const at = (hour: number, code: number) => {
          const d = new Date(base);
          d.setDate(d.getDate() + 1);
          d.setHours(hour, 0, 0, 0);
          return { ms: d.getTime(), code };
        };
        const rows: Array<{ ms: number; code: number }> = [];
        for (let hr = 10; hr <= 15; hr++) rows.push(at(hr, 804));
        for (let hr = 16; hr <= 18; hr++) rows.push(at(hr, 521));
        for (let hr = 19; hr <= 22; hr++) rows.push(at(hr, 211));
        return rows;
      })(),
    },
    cityHint: 'Prisdorf',
    namedCity: true,
    nowMs: Date.parse('2026-09-17T10:00:00'),
    userText: 'Wie wird das Wetter?',
  });
  assert(/Während|zeigt/i.test(radio.speech), 'radio contrast opener');
  assert(/morgen/i.test(radio.speech), 'mentions tomorrow');
  assert(/Schauer|Regen/i.test(radio.speech), 'shower clause');
  assert(/Wind|Höchst/i.test(radio.speech), 'wind or high woven');
  assert(/18|Grad/i.test(radio.speech), 'high temp');
  assert(!/Regenrisiko|%|Prozent/i.test(radio.speech), 'no percent dump');
  assert(
    radio.speech.split(/[.!?]+/).filter((s) => s.trim()).length <= 3,
    'max 3 sätze radio',
  );
  assert(!/Also,|kurz zum wetter/i.test(radio.speech), 'no opener');
  assert(/13° bis 18°/.test(radio.bullets[0] ?? ''), `temp chip: ${radio.bullets[0]}`);
  const chipLine = radio.bullets.join(' | ');
  assert(/10 bis 16 Uhr/.test(chipLine), `cloud window: ${chipLine}`);
  assert(/16 bis 19 Uhr/.test(chipLine), `shower window: ${chipLine}`);
  assert(/ab 19 Uhr/.test(chipLine), `storm window: ${chipLine}`);
  assert(radio.bullets.length <= 4, 'max 4 timeline chips');
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
