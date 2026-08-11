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
    try {
      const snap = await ensureWeatherFresh(
        'force',
        a ? { lat: a.lat, lng: a.lng } : null,
      );
      refreshRucksackWeather();
      summary = snap?.summaryLine ?? null;
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

    const plan = planEveningHint();
    const windyWater =
      /\b(wind|wasser|förde|foerde|strand|elbe|meer|küste|kueste)\b/i.test(
        task.rewrittenText,
      );

    const outfit = buildOutfitAdviceFromWeather({
      nowTempC: nowTemp,
      dayHighC: dayHigh,
      precipProbPct: precip,
      windy: windyWater,
    });

    const clothingBits: string[] = [];
    if (plan.dresscode) clothingBits.push(`Dresscode-Hint: ${plan.dresscode}`);
    clothingBits.push(...outfit.clothingBits);
    if (plan.stars === 5) {
      clothingBits.push('kein reiner Sportlook bei Fine-Dining/Rooftop');
    }

    const draft = [
      'FAKTEN Umwelt (nicht wörtlich vorlesen):',
      dest ? `Ort-Kontext: ${dest}` : null,
      summary ? `Wetter-Summary: ${summary}` : null,
      nowTemp != null ? `Jetzt ~${Math.round(Number(nowTemp))} °C` : null,
      dayHigh != null ? `Tageshoch bis Abend ~${Math.round(dayHigh)} °C` : null,
      outfit.eveningTempC != null
        ? `Abend-Schätzung ~${outfit.eveningTempC} °C`
        : null,
      outfit.trendHint ? `Trend: ${outfit.trendHint}` : null,
      precip != null
        ? `Niederschlagswahrscheinlichkeit ~${Math.round(precip)} %`
        : null,
      rainHint ? `Radar: ${rainHint}` : null,
      plan.title ? `Plan heute Abend: ${plan.title}` : null,
      ...clothingBits,
      'FLOW (Struktur, Wortlaut frei):',
      '1) Konkrete Kleidung ZUERST — am TAGESHOCH / Tagesverlauf ausrichten, nicht nur an der ersten kühlen Stunde.',
      '2) Wenn morgens frischer und später wärmer: kurze Extra-Lage (leichte Jacke) erwähnen; KEIN dicker Pulli / keine Winterhose als Haupt-Tipp nur wegen Morgenwert.',
      '3) Wetter kurz als Begründung (Jetzt + Trend/Hoch + Regen).',
      '4) Wenn Plan-Stop bekannt: Dresscode daran koppeln.',
      '5) KEINE Timeline öffnen, kein „Passt der Plan?“.',
      '6) Wohin-gehen nur wenn User danach fragt.',
    ]
      .filter(Boolean)
      .join('\n');

    const wantsOutfit =
      /\b(anzieh|outfit|kleidung|jacke|pulli|hose)\b/i.test(task.rewrittenText);

    return {
      agent: 'umwelt',
      ok: true,
      draftText: draft,
      bullets: [
        wantsOutfit
          ? clothingBits.find((b) => !/^Dresscode/i.test(b))?.slice(0, 42) ||
            'Schichten'
          : dayHigh != null
            ? `bis ~${Math.round(dayHigh)} °C`
            : nowTemp != null
              ? `~${Math.round(Number(nowTemp))} °C`
              : 'Wetter',
        precip != null && precip >= 40
          ? 'Regenjacke'
          : windyWater
            ? 'Windjacke'
            : outfit.morningFresher
              ? 'leichte Jacke morgens'
              : plan.dresscode
                ? plan.dresscode.slice(0, 40)
                : 'Schichten',
        plan.title ? `Plan: ${plan.title.slice(0, 36)}` : null,
      ]
        .filter(Boolean)
        .slice(0, 3) as string[],
      buttons: [],
      meta: {
        weather_or_outfit: true,
        planTitle: plan.title,
        dresscode: plan.dresscode,
        eveningTempC: outfit.eveningTempC,
        dayHighC: dayHigh,
        nowTempC: nowTemp,
        precipProbability: precip,
      },
    };
  },
};
