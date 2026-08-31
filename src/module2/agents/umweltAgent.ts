import type { Module2Agent } from './types';
import { resolveWorkingPlace } from '../context/placeContext';
import { ensureWeatherFresh } from '../../services/weatherService';
import { useRucksackStore } from '../rucksack/rucksackStore';
import { refreshRucksackWeather } from '../rucksack/rucksackWriters';
import {
  buildOutfitAdviceFromWeather,
  extractTempsFromWeatherText,
} from '../../services/weather/outfitFromWeather';

function planEveningHint(): {
  title: string | null;
  dresscode: string | null;
  stars: number | null;
} {
  try {
    const { useFuturePlanStore } = require('../timeline/futurePlanState') as {
      useFuturePlanStore: {
        getState: () => {
          stops: Array<{
            title?: string;
            plannedStartMs?: number | null;
            tags?: string[];
            priority?: number;
          }>;
        };
      };
    };
    const stops = useFuturePlanStore.getState().stops ?? [];
    const now = Date.now();
    const evening = stops
      .filter((s) => {
        const t = s.plannedStartMs;
        if (t == null) return /abend|dinner|party|rooftop|restaurant|5\s*\★|★/i.test(
          `${s.title ?? ''} ${(s.tags ?? []).join(' ')}`,
        );
        const d = new Date(t);
        return d.getTime() >= now && d.getHours() >= 16;
      })
      .sort(
        (a, b) =>
          (a.plannedStartMs ?? Number.MAX_SAFE_INTEGER) -
          (b.plannedStartMs ?? Number.MAX_SAFE_INTEGER),
      );
    const hit = evening[0];
    if (!hit) return { title: null, dresscode: null, stars: null };
    const blob = `${hit.title ?? ''} ${(hit.tags ?? []).join(' ')}`.toLowerCase();
    let dresscode: string | null = null;
    if (/rooftop|club|party|5\s*\★|fine\s*dining|★{3,}/i.test(blob)) {
      dresscode = 'smart-casual / etwas schicker (kein Sportlook)';
    } else if (/strand|beach|spikeball|wandern|rad/i.test(blob)) {
      dresscode = 'praktisch + windfest, Schuhe mit Grip';
    } else if (/restaurant|dinner|essen/i.test(blob)) {
      dresscode = 'lässig-schick reicht meist';
    } else {
      dresscode = 'an den Abendplan angepasst — Schichten';
    }
    const stars = /5\s*\★|★★★★★/.test(blob)
      ? 5
      : /★{3,}|3\s*\★/.test(blob)
        ? 3
        : null;
    return { title: hit.title?.trim() || null, dresscode, stars };
  } catch {
    return { title: null, dresscode: null, stars: null };
  }
}

/**
 * Umwelt-Agent liefert Fakten + FLOW-Hint für die Synthese —
 * keine ortsspezifischen Vorlese-Skripte.
 */
export const umweltAgent: Module2Agent = {
  id: 'umwelt',
  intents: ['umwelt'],
  async run({ task, rucksack }) {
    const dest = resolveWorkingPlace(
      task.rewrittenText,
      rucksack.cityHint,
      task.city,
    ).speechPlace;
    const a =
      rucksack.gpsHistory[rucksack.gpsHistory.length - 1] ?? null;

    let nowTemp: number | null = null;
    let dayHigh: number | null = null;
    let precip: number | null = null;
    let summary: string | null = null;
    let rainHint: string | null = null;
    let tomorrowSummary: string | null = null;
    let weatherCode: number | null = null;
    try {
      const snap = await ensureWeatherFresh(
        'force',
        a ? { lat: a.lat, lng: a.lng } : null,
        { userAsked: true },
      );
      refreshRucksackWeather();
      summary = snap?.summaryLine ?? null;
      tomorrowSummary = snap?.tomorrowSummary?.trim() || null;
      weatherCode = snap?.weatherCode ?? null;
      const extracted = extractTempsFromWeatherText({
        summaryLine: snap?.summaryLine,
        promptBlock: snap?.promptBlock,
        currentTempC: snap?.currentTempC ?? null,
        dayHighC: snap?.dayHighC ?? null,
      });
      nowTemp = extracted.nowTempC;
      dayHigh = extracted.dayHighC;
      if (snap?.nextRainProb != null) {
        precip =
          snap.nextRainProb <= 1
            ? snap.nextRainProb * 100
            : snap.nextRainProb;
      }
      rainHint =
        snap?.rainStartsInMin != null
          ? `Regen in etwa ${snap.rainStartsInMin} Minuten`
          : snap?.nextRainAtMs
            ? `Regen ab ca. ${new Date(snap.nextRainAtMs).toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : null;
      useRucksackStore.getState().setWeather({
        updatedAtMs: snap?.fetchedAtMs ?? Date.now(),
        tempC: nowTemp,
        feelsLikeC: nowTemp,
        precipProbability: precip,
        summary: snap?.summaryLine ?? null,
        rainRadarHint: rainHint,
      });
    } catch {
      const w = useRucksackStore.getState().bag.weather;
      nowTemp = w?.feelsLikeC ?? w?.tempC ?? null;
      precip = w?.precipProbability ?? null;
      summary = w?.summary ?? null;
      rainHint = w?.rainRadarHint ?? null;
      if (summary) {
        const extracted = extractTempsFromWeatherText({ summaryLine: summary });
        nowTemp = nowTemp ?? extracted.nowTempC;
        dayHigh = extracted.dayHighC;
      }
    }

    const futureDay = /\b(morgen|übermorgen|uebermorgen)\b/iu.test(
      task.rewrittenText,
    );
    const plan = planEveningHint();
    const windyWater =
      /\b(wind|wasser|förde|foerde|strand|elbe|meer|küste|kueste)\b/i.test(
        task.rewrittenText,
      );

    // „heute Nachmittag / um 17 Uhr anziehen“ → Zielstunde statt nur Jetzt
    const hourMatch = task.rewrittenText.match(
      /\b(?:um\s+)?(\d{1,2})(?::(\d{2}))?\s*uhr\b/i,
    );
    const afternoonAsk =
      /\b(nachmittag|abend|später|spaeter|heute\s+abend)\b/i.test(
        task.rewrittenText,
      );
    let targetHour: number | null = hourMatch
      ? Math.min(23, Math.max(0, Number(hourMatch[1])))
      : afternoonAsk
        ? 17
        : null;
    let targetTempC: number | null = null;
    if (targetHour != null && dayHigh != null && nowTemp != null) {
      // Grobe Kurve: Jetzt/Vormittag → Hoch (mittags) → Abend bleibt warm nah am Hoch
      const h = targetHour;
      if (h <= 10) targetTempC = nowTemp;
      else if (h <= 16) targetTempC = dayHigh;
      else if (h <= 20) {
        // 17–20 Uhr: kaum Abkühlung erfinden (z. B. 25° Hoch → ~24°)
        targetTempC = Math.round(dayHigh - Math.max(0, (h - 16) * 0.35));
      } else {
        // Spätabend: leicht runter, aber nicht unter max(now, high−3)
        const floor = Math.max(nowTemp, dayHigh - 3);
        targetTempC = Math.round(
          Math.max(floor, dayHigh - (h - 16) * 0.5),
        );
      }
      targetTempC = Math.max(targetTempC, Math.min(nowTemp, dayHigh));
    }

    const outfit = buildOutfitAdviceFromWeather({
      nowTempC: nowTemp,
      dayHighC: dayHigh,
      // Nur als Abend-Temp durchreichen wenn User explizit Abend/Uhrzeit meint
      eveningTempC:
        targetHour != null && targetHour >= 17 ? targetTempC : null,
      precipProbPct: precip,
      windy: windyWater,
    });

    const clothingBits: string[] = [];
    if (plan.dresscode) clothingBits.push(`Dresscode-Hint: ${plan.dresscode}`);
    clothingBits.push(...outfit.clothingBits);
    if (targetHour != null && targetTempC != null) {
      clothingBits.push(
        `Zielzeit ~${String(targetHour).padStart(2, '0')}:00 ≈ ${Math.round(targetTempC)} °C anziehen`,
      );
    }
    if (plan.stars === 5) {
      clothingBits.push('kein reiner Sportlook bei Fine-Dining/Rooftop');
    }

    const wantsOutfit =
      /\b(anzieh|outfit|kleidung|jacke|pulli|hose)\b/i.test(task.rewrittenText);

    const draft = [
      'FAKTEN Umwelt (nicht wörtlich vorlesen):',
      dest ? `Ort-Kontext: ${dest}` : null,
      futureDay && tomorrowSummary
        ? `Morgen-Vorhersage (belegt): ${tomorrowSummary}`
        : summary
          ? `Wetter-Summary: ${summary}`
          : null,
      !futureDay && nowTemp != null
        ? `Jetzt ~${Math.round(Number(nowTemp))} °C`
        : null,
      !futureDay && dayHigh != null
        ? `Tageshoch bis Abend ~${Math.round(dayHigh)} °C`
        : null,
      weatherCode != null ? `Wettercode: ${weatherCode}` : null,
      targetHour != null && targetTempC != null
        ? `Für ~${String(targetHour).padStart(2, '0')}:00 ≈ ${Math.round(targetTempC)} °C`
        : null,
      outfit.eveningCool && outfit.eveningTempC != null
        ? `Abend wirklich kühler ~${outfit.eveningTempC} °C (Extra-Lage ok)`
        : outfit.eveningTempC != null && targetHour != null
          ? `Abend-Schätzung ~${outfit.eveningTempC} °C (nicht als „frisch“ verkaufen wenn ≥16°)`
          : null,
      outfit.trendHint ? `Trend: ${outfit.trendHint}` : null,
      precip != null
        ? `Niederschlagswahrscheinlichkeit ~${Math.round(precip)} %`
        : null,
      rainHint ? `Radar: ${rainHint}` : null,
      plan.title ? `Plan heute Abend: ${plan.title}` : null,
      ...clothingBits,
      'FLOW (Struktur, Wortlaut frei, locker wie ein lokaler Freund):',
      'NUR Jetzt + Zukunft (Rest des Tages / gefragter Tag). Vergangene Morgenkühle NICHT nachtragen.',
      'VERBOTEN: Aushang, schwarzes Brett, Bahnhof, „selber nachgucken“; kein Gewitter ohne Beleg.',
      wantsOutfit
        ? targetHour != null
          ? `1) Konkrete Kleidung ZUERST — für ca. ${String(targetHour).padStart(2, '0')}:00, am belegten Trend.`
          : '1) Konkrete Kleidung ZUERST — am Jetzt + Tageshoch ausrichten.'
        : futureDay
          ? '1) Morgen: Himmel (Sonne/Wolken), Temperatur von–bis, Regenrisiko — locker erzählen.'
          : '1) Himmel + Temperatur (Jetzt/Spitze) + wann Regen — locker erzählen.',
      wantsOutfit
        ? '2) Wetter kurz als Begründung.'
        : '2) Ein Kleidungstipp hinten (bei Nässe Jacke/Schirm); Jacke nicht erzwingen wenn mild/trocken.',
      '3) Stichpunkte: Himmel · Temperatur · Kleidung.',
      '4) Abend nur „frisch/kühl“ nennen wenn Forecast wirklich kühl (<~16°).',
      '5) Wenn Plan-Stop bekannt und Outfit gefragt: Dresscode daran koppeln.',
      '6) KEINE Timeline öffnen, kein „Passt der Plan?“.',
      '7) Wohin-gehen nur wenn User danach fragt.',
    ]
      .filter(Boolean)
      .join('\n');

    let bullets: string[] = [];
    try {
      const {
        formatWeatherBullets,
        formatTomorrowWeatherChat,
      } = require('../../services/ui/weatherDayPlanSpeech') as {
        formatWeatherBullets: (s: unknown) => string[];
        formatTomorrowWeatherChat: (s: unknown) => { bullets: string[] };
      };
      if (futureDay && tomorrowSummary) {
        bullets = formatTomorrowWeatherChat({
          tomorrowSummary,
          dayHighC: dayHigh,
          nextRainProb: precip,
          weatherCode,
        }).bullets;
      } else {
        bullets = formatWeatherBullets({
          currentTempC: nowTemp,
          dayHighC: dayHigh,
          nextRainProb: precip,
          weatherCode,
          summaryLine: summary,
          isHeavyRain: false,
          rainStartsInMin: null,
        });
      }
    } catch {
      bullets = [
        dayHigh != null
          ? `bis ~${Math.round(dayHigh)} °C`
          : nowTemp != null
            ? `~${Math.round(Number(nowTemp))} °C`
            : 'Wetter',
        precip != null && precip >= 40 ? 'Regen möglich' : 'weitgehend trocken',
        clothingBits.find((b) => !/^Dresscode/i.test(b))?.slice(0, 40) ||
          'leichte Lage',
      ];
    }

    return {
      agent: 'umwelt',
      ok: true,
      draftText: draft,
      bullets: bullets.slice(0, 3),
      buttons: [],
      meta: {
        weather_or_outfit: true,
        planTitle: plan.title,
        dresscode: plan.dresscode,
        eveningTempC: outfit.eveningTempC,
        dayHighC: dayHigh,
        nowTempC: nowTemp,
        precipProbability: precip,
        tomorrowSummary,
      },
    };
  },
};
