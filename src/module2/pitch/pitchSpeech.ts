/**
 * LLM nur Pitch-Text — 180–200 Zeichen/Ort, motivierend.
 */

import { generateGeminiText } from '../../services/geminiService';
import {
  FINDUS_ANSWER_FIRST_BLOCK,
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_WOVEN_PITCH_SPEECH_BLOCK,
} from '../../services/concierge/findusResponsePolicy';
import type { PitchCandidate, PitchRequest } from './types';
import { travelHintFromMeters, userDeclaredCar } from '../router/placeGoQuery';
import { hoursPitchHint } from '../agents/placeHoursFit';
import { lookCueSpeechToDest } from '../../services/navigation/module1Facing';
import { weaveDualOptionSpoken } from '../../services/concierge/dualOptionPolicy';
import { getCachedUserProfile } from '../../services/userProfileService';
import {
  buildPersonalityMatrixPromptBlock,
} from '../../services/persona/personalityMatrixPrompt';

function hoursHint(c: PitchCandidate, visitAtMs?: number): string | null {
  return hoursPitchHint(
    {
      openNow: c.openNow as boolean,
      opensAtMin: c.opensAtMin,
      closesAtMin: c.closesAtMin,
    },
    visitAtMs ?? Date.now(),
  );
}

function buildPitchSystemInstruction(): string {
  const matrixBlock = buildPersonalityMatrixPromptBlock(getCachedUserProfile());
  return `Du bist Yorro Pitcher für Auswahlsituationen. Schreibe für genau zwei Orte je einen motivierenden Pitch UND einen durchgehenden spokenFlow fürs Vorlesen.
Länge je speechPitch: 140–280 Zeichen. 1–2 knackige Sätze — Warum hingehen, Du-Form, Deutsch. Belegte Fakten (Gerichtspreis, Distanz, Spezialität, Review-Ambiente) in denselben Satz packen.

${matrixBlock}

${FINDUS_WOVEN_PITCH_SPEECH_BLOCK}

${FINDUS_ANSWER_FIRST_BLOCK}

HARD-MATCH PITCH-BLAUPAUSE (Struktur, Wortlaut frei):
1) User-Wunsch + warum DIESERort: Beleg aus Daten/Tags/Insider/hardEvidence — nichts erfinden.
2) Konkret zum Wunsch + Gerichtspreis NUR wenn dish_price in den Daten. Distanz aus dist_km einweben (nie weglassen). Fahrzeit NUR wenn car=yes und drive_min gesetzt — sonst nur Kilometer, keine erfundenen Minuten.
3) Gastro: Review-Ambiente aus insider/hookNotes (gemütlich, Portionen, Service, Spezialität) ehrlich einweben — den Laden schmackhaft machen, nichts erfinden.
4) Hotel: Buchbarkeit/Preis klar. Zeit-ehrlich: Abend-Termin ≠ jetzt los.
Die beiden Pitches MÜSSEN sich inhaltlich unterscheiden. Nie „Soll ich raussuchen?“.
Öffnungszeiten NICHT im normalen Pitch — nur wenn hours_frame=closed oder hours_frame=closes_soon. Gastro: kein Wetter im Pitch (Wetter war die Bridge). Sight/Outdoor: Kleidung/Wetter nur wenn Aktivität draußen und es kohärent hilft — nie erzwingen, nie bei Indoor-Museum Pflicht-Outfit. Kein Meta über den vorherigen Essenswunsch.
Preis: nur dish_price / belegtes Gerichts-€. Nie priceLevel raten, nie ~9 € erfinden, nie price_total als Gericht. Keine Adresse/Telefon/Meta („Option A“, „Erstens“, „Und falls der nicht sitzt“).
Empfehlung nur wenn einer klar besser ist (in summary), sonst neutral.
MODUS city_best / „am besten“: Lead mit warum DIESE Option zum Wunsch (Gericht/Küche) die stärkere ist — nur rating, ratingCount, insider/Reviews, hard_match. Nichts erfinden. Nähe allein reicht nicht.
WUNSCH NICHT BELEGT (soft_fail, kein hard_match auf dem Gericht): ehrlich — Wunsch so nicht belegt → nächste Stufe derselben Familie (Pannfisch → Fischlokal), nie die Gegen-Diät (Fisch-Wunsch ≠ vegan). Immer konkrete Orte, nie leere Absage.
BENANNTER LADEN (must venue): Nur diesen Ort pitchen. Nicht durch Nearby-Alternativen ersetzen, weil er nicht in der GPS-Stadt liegt. Reviews, belegte Gerichte, belegte Preise. Wie man hinkommt. Kurze Frage ob Tisch reservieren. Keine erfundenen Euro. Kein „liegt nicht in … deshalb woanders“.
JETZT ZU (open=false / hours_frame=closed): nicht „los jetzt“. Struktur: gerade geschlossen → dieselben Orte für morgen (Uhr wenn belegt).
Ohne Auto (car=no): Distanz in km, keine Auto-Kurzfahrt. „Ihr habt Zeit / kein Problem was zu finden“ NUR bei soft_fail, zu, oder viel zu weit — sonst Wunsch würdigen.
IMMER eine Antwort mit Orten, sobald der Katalog welche hat.
Stichpunkte: max 3 — Wunsch-Beleg (Gericht/Amenity/Preis), Öffnung wenn relevant, Distanz höchstens 1×. KEINE Roh-Sterne, KEINE „X Sterne bei Y Bewertungen“, KEINE doppelte km-Angabe.

spokenFlow: EIN mündlicher Fließtext für beide Orte. Nach bereits gesprochener Bridge ohne zweites Intro und ohne Wetter. Entweder Ort A (Fakten im Satz) — oder Ort B (Fakten im Satz) — kurze Wahlfrage. Umgangssprache, zackig, keine Liste.

${FINDUS_FEW_SHOT_DISCLAIMER}

JSON:
{
  "summary": "optional ein Satz",
  "spokenFlow": "…",
  "cards": [
    { "name": "Ort", "speechPitch": "…", "bulletPoints": ["…","…","…"] }
  ]
}`;
}

function nearbyLookPrefix(c: PitchCandidate): string | null {
  const d = c.distFromAnchorM;
  if (d == null || d > 90) return null;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { lastGpsLat: number | null; lastGpsLng: number | null };
      };
    };
    const s = useFinnusStore.getState();
    if (typeof s.lastGpsLat !== 'number' || typeof s.lastGpsLng !== 'number') {
      return null;
    }
    return (
      lookCueSpeechToDest({
        userLat: s.lastGpsLat,
        userLng: s.lastGpsLng,
        destLat: c.lat,
        destLng: c.lng,
      }) || null
    );
  } catch {
    return null;
  }
}

function fallbackPitch(
  c: PitchCandidate,
  softFail: boolean,
  visitAtMs?: number,
): { speechPitch: string; bullets: string[] } {
  const hint =
    c.distFromAnchorM != null
      ? travelHintFromMeters(c.distFromAnchorM)
      : null;
  const dist = hint ? hint.distLabel : null;
  const hasCar = userDeclaredCar();
  const eta = hint && hasCar && hint.etaLabel !== hint.distLabel ? hint.etaLabel : null;
  const ratingLabel =
    c.rating != null && (c.ratingCount ?? 0) >= 20
      ? c.rating >= 4.5
        ? 'super bewertet'
        : c.rating >= 4.0
          ? 'gut bewertet'
          : null
      : null;
  const detour =
    c.detourMinApprox != null && c.detourMinApprox > 0.5
      ? `Umweg ~${Math.round(c.detourMinApprox)} Min`
      : null;
  const hours = hoursHint(c, visitAtMs);
  const evidence = (c.hardEvidence ?? []).slice(0, 2).join(', ') || null;
  const insider = (c.hookNotes ?? []).find((n) => String(n).trim().length >= 12) ?? null;
  const lead = softFail
    ? hours && /gerade zu/.test(hours)
      ? 'Heute zu — stark für morgen.'
      : 'Kein Spezial-Treffer, aber eine ehrliche Alternative.'
    : evidence
      ? `Passt zu: ${evidence}.`
      : insider
        ? `${String(insider).trim().slice(0, 120)}.`
        : ratingLabel
          ? `Wirkt ${ratingLabel}.`
          : hint
            ? `Liegt ${hint.speech}.`
            : null;
  // Umweg früh, wenn da — Zwischenstopp-Abwägung, User entscheidet
  const speechPitch = [
    lead,
    detour,
    evidence && lead && !String(lead).startsWith('Passt zu:')
      ? `Passt zu: ${evidence}.`
      : null,
    c.dishPriceHint
      ? `${c.dishPriceHint}.`
      : c.pricePerNightEur != null && c.priceTotalEur != null
        ? `Live ${Math.round(c.priceTotalEur)} € gesamt (ca. ${Math.round(c.pricePerNightEur)} €/Nacht).`
        : null,
    ratingLabel && lead && !/bewertet/.test(String(lead))
      ? `Wirkt ${ratingLabel}.`
      : null,
    hint && !(lead && String(lead).startsWith('Liegt '))
      ? `Liegt ${hint.speech}.`
      : null,
    hours ? `Öffnung ${hours}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 780);
  const look = nearbyLookPrefix(c);
  const withLook = look ? `${look} — ${c.name}. ${speechPitch}` : speechPitch;
  // Stichpunkte: Wunsch/Preis/Öffnung vor Distanz — keine Roh-Sterne
  const bullets = [
    evidence,
    c.dishPriceHint,
    hours,
    c.pricePerNightEur != null && c.priceTotalEur != null && !c.dishPriceHint
      ? `${Math.round(c.priceTotalEur)} € live`
      : null,
    eta,
    dist,
    detour,
  ]
    .filter(Boolean)
    .slice(0, 3) as string[];
  return { speechPitch: withLook, bullets };
}

function parseJson(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() || t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type PitchedCard = {
  candidate: PitchCandidate;
  speechPitch: string;
  bullets: string[];
};

export async function generatePitchSpeech(opts: {
  req: PitchRequest;
  top: PitchCandidate[];
  /** Full Top-5 for ResearchPack; speak still uses top (2) */
  shortlist?: PitchCandidate[];
  softFail: boolean;
  softFailReason?: string;
  signal?: AbortSignal;
}): Promise<{ summary: string; cards: PitchedCard[]; spokenText: string }> {
  const top = opts.top.slice(0, 2);
  const packList = (opts.shortlist?.length ? opts.shortlist : opts.top).slice(0, 5);
  const catalog = top
    .map((c, i) => {
      const hint =
        c.distFromAnchorM != null
          ? travelHintFromMeters(c.distFromAnchorM)
          : null;
      const hasCar = userDeclaredCar();
      const hours = hoursHint(c, opts.req.visitAtMs);
      const hoursFrame =
        c.openNow === false || c.closedOnVisitDay === true
          ? 'closed'
          : hours
            ? 'closes_soon'
            : 'open_ok';
      return `${i + 1}. ${c.name} | rating=${c.rating ?? 'n/a'} | ratingCount=${c.ratingCount ?? 'n/a'} | dist_m=${Math.round(
        c.distFromAnchorM ?? 0,
      )}${hint ? ` | dist_km=${hint.distLabel}${hasCar ? ` | walk_min=${hint.walkMinutes} | drive_min=${hint.driveMinutes}` : ''} | eta_speech=${hint.speech}` : ''} | detour_min≈${(c.detourMinApprox ?? 0).toFixed(1)} | tags=${(
        c.softTags ?? []
      )
        .slice(0, 8)
        .join(',')} | open=${c.openNow ?? '?'} | hours_frame=${hoursFrame}${
        c.hardEvidence?.length
          ? ` | hard_match=${c.hardEvidence.slice(0, 4).join('+')}`
          : ' | hard_match=none'
      }${
        c.openNow === false || c.closedOnVisitDay === true
          ? ' | closed_now=yes suggest=tomorrow'
          : ''
      }${
        c.dishPriceHint ? ` | dish_price=${c.dishPriceHint}` : ''
      }${
        c.priceTotalEur != null && c.pricePerNightEur != null
          ? ` | price_total=${Math.round(c.priceTotalEur)}€ | per_night≈${Math.round(c.pricePerNightEur)}€${
              c.nights != null ? ` | nights=${c.nights}` : ''
            }${c.checkin && c.checkout ? ` | ${c.checkin}→${c.checkout}` : ''}`
          : ''
      }${
        hours ? ` | hours=${hours}` : ''
      }${
        c.hookNotes?.length
          ? ` | insider=${c.hookNotes.slice(0, 3).join(' · ')}`
          : ''
      }${c.websiteUrl ? ` | website=${c.websiteUrl}` : ''}${
        c.bookingUrl ? ` | booking=yes` : ''
      } | car=${hasCar ? 'yes' : 'no'}`;
    })
    .join('\n');

  let summary = opts.softFail
    ? opts.softFailReason ||
      'Nichts Perfektes — hier zwei Alternativen mit besseren Chancen.'
    : '';
  let cards: PitchedCard[] = top.map((c) => {
    const fb = fallbackPitch(c, opts.softFail, opts.req.visitAtMs);
    return { candidate: c, speechPitch: fb.speechPitch, bullets: fb.bullets };
  });

  let spokenFlow = '';
  try {
    let researchBlock = '';
    try {
      const {
        buildDiningResearchPack,
        formatResearchPackForPrompt,
      } = require('../reboot/pipeline/researchPack') as {
        buildDiningResearchPack: (o: unknown) => unknown;
        formatResearchPackForPrompt: (p: unknown) => string;
      };
      const {
        getCall1AnswerContract,
        formatCall1AnswerContractForPrompt,
      } = require('../reboot/pipeline/call1AnswerContract') as {
        getCall1AnswerContract: (t: string) => unknown;
        formatCall1AnswerContractForPrompt: (c: unknown) => string;
      };
      const contract = getCall1AnswerContract(
        `${opts.req.title} ${opts.req.context}`,
      );
      researchBlock = formatCall1AnswerContractForPrompt(contract);
      if (opts.req.kind === 'food' || opts.req.kind === 'bar') {
        let ambient: Record<string, string | number | boolean | null> = {};
        try {
          const { getLastWeatherSnapshot } = require('../../services/weatherService') as {
            getLastWeatherSnapshot: () => {
              sunsetMs?: number | null;
              tempC?: number | null;
              conditionLabel?: string | null;
            } | null;
          };
          const w = getLastWeatherSnapshot?.();
          if (w?.sunsetMs) {
            const d = new Date(w.sunsetMs);
            ambient.sunset_hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
          }
          if (w?.tempC != null) ambient.temp_c = w.tempC;
          if (w?.conditionLabel) ambient.sky = w.conditionLabel;
        } catch {
          /* soft */
        }
        const pack = buildDiningResearchPack({
          authorIntent: opts.req.authorIntent ?? null,
          spokenBridge: opts.req.continueFromBridge ?? null,
          userText: `${opts.req.title} ${opts.req.context}`,
          wishes: opts.req.wishes,
          visitAtMs: opts.req.visitAtMs,
          shortlist: packList,
          ambient,
          timelineNote: null,
        });
        researchBlock = `${researchBlock}\n${formatResearchPackForPrompt(pack)}`;
      }
    } catch {
      /* soft */
    }
    const raw = await generateGeminiText(
      [
        `WUNSCH: ${opts.req.title}`,
        `KONTEXT: ${opts.req.context}`,
        opts.req.authorIntent
          ? `CALL1_INTENT (befolgen — das will der User JETZT):\n${opts.req.authorIntent}`
          : '',
        `MUST_HAVES: ${
          (opts.req.call1MustHaves ?? []).join(', ') ||
          opts.req.wishes
            .filter((w) => w.hardness === 'must')
            .map((w) => `${w.kind ?? 'x'}:${w.text}`)
            .join(' | ') ||
          '—'
        }`,
        researchBlock,
        'RANKING: Favorit = beste Passung aus Hard-Match, Reviews/Tags, Distanz, Preis, Öffnung. Alternative = nächstbeste. Nur Orte aus ORTE — nichts erfinden.',
        opts.req.continueFromBridge
          ? `BRIDGE SCHON GESPROCHEN (nicht wiederholen, flüssig anschließen):\n${opts.req.continueFromBridge}\nsummary leer lassen. spokenFlow beginnt bei den Orten — kein zweites Wunsch-Intro, kein Wetter, kein Taxi/Steak-Meta.`
          : 'Keine Bridge vorher. spokenFlow startet bei den Orten (Gastro: kein Wetter-Beat). Entweder/Oder.',
        `MODUS: ${opts.req.searchMode}`,
        opts.softFail ? `SOFT_FAIL: ${opts.softFailReason ?? 'yes'}` : '',
        `ORTE (bereits gerankt, #1 = beste Entscheidung):\n${catalog}`,
      ]
        .filter(Boolean)
        .join('\n'),
      {
        systemInstruction: buildPitchSystemInstruction(),
        useFindusSystem: false,
        responseJson: true,
        jsonMimeOnly: true,
        temperature: 0.5,
        maxTokens: 1200,
        signal: opts.signal ?? opts.req.signal,
        task: 'itinerary',
      },
    );
    const parsed = parseJson(raw);
    if (parsed) {
      if (
        typeof parsed.spokenFlow === 'string' &&
        parsed.spokenFlow.trim().length >= 40
      ) {
        spokenFlow = parsed.spokenFlow.replace(/\s+/g, ' ').trim().slice(0, 1200);
      }
      if (
        typeof parsed.summary === 'string' &&
        parsed.summary.trim() &&
        !opts.req.continueFromBridge
      ) {
        summary = parsed.summary.trim().slice(0, 160);
      }
      const arr = Array.isArray(parsed.cards) ? parsed.cards : [];
      const next: PitchedCard[] = [];
      for (const c of top) {
        const row = arr.find(
          (x) =>
            x &&
            typeof x === 'object' &&
            String((x as { name?: string }).name ?? '')
              .toLowerCase()
              .includes(c.name.toLowerCase().slice(0, 10)),
        ) as
          | { speechPitch?: string; bulletPoints?: unknown[] }
          | undefined;
        const fb = fallbackPitch(c, opts.softFail, opts.req.visitAtMs);
        let speech = String(row?.speechPitch ?? fb.speechPitch)
          .trim()
          .slice(0, 780);
        if (speech.length < 50) speech = fb.speechPitch;
        const hint =
          c.distFromAnchorM != null
            ? travelHintFromMeters(c.distFromAnchorM)
            : null;
        if (hint && !/\d+\s*(min|km|m)\b/iu.test(speech)) {
          speech = `${speech} ${hint.speech.charAt(0).toUpperCase()}${hint.speech.slice(1)}.`;
        }
        if (
          c.dishPriceHint &&
          !/\d+[.,]?\d*\s*€/.test(speech)
        ) {
          speech = `${speech} ${c.dishPriceHint}.`;
        } else if (
          c.pricePerNightEur != null &&
          c.priceTotalEur != null &&
          !/\d+[.,]?\d*\s*€/.test(speech)
        ) {
          speech = `${speech} Live ${Math.round(c.priceTotalEur)} € gesamt (ca. ${Math.round(c.pricePerNightEur)} €/Nacht).`;
        }
        speech = speech
          .replace(
            /\s*(soll ich|sollte ich|willst du dass ich|möchtest du dass ich)[^.?]*\??\s*$/iu,
            '',
          )
          .trim();
        const look = nearbyLookPrefix(c);
        if (look && !speech.toLowerCase().includes(look.slice(0, 10).toLowerCase())) {
          speech = `${look} — ${c.name}. ${speech}`;
        }
        const llmBullets = (
          Array.isArray(row?.bulletPoints)
            ? row!.bulletPoints!.map((x) => String(x).trim()).filter(Boolean)
            : []
        );
        const forced: string[] = [];
        const evidenceBits = (c.hardEvidence ?? [])
          .map((x) => String(x).trim())
          .filter((x) => x.length >= 4)
          .slice(0, 2);
        forced.push(...evidenceBits);
        if (c.dishPriceHint) {
          forced.push(c.dishPriceHint);
        } else if (c.pricePerNightEur != null && c.priceTotalEur != null) {
          forced.push(`${Math.round(c.priceTotalEur)} € live`);
        }
        const hours = hoursHint(c, opts.req.visitAtMs);
        if (hours) forced.push(hours);
        // Distanz nur wenn LLM sie nicht schon hat — max 1×
        const llmHasDist = llmBullets.some((b) =>
          /\d+[.,]?\d*\s*(km|m)\b/iu.test(b),
        );
        if (hint && !llmHasDist) {
          const hasCar = userDeclaredCar();
          forced.push(
            hasCar && hint.etaLabel !== hint.distLabel
              ? `${hint.etaLabel} · ${hint.distLabel}`
              : hint.distLabel,
          );
        }
        const bullets = [
          ...forced,
          ...(llmBullets.length ? llmBullets : fb.bullets),
        ]
          .filter((b) => !/\b\d+[.,]\d+\s*★|\bsterne?\b|\bbewertungen?\b/iu.test(b))
          .filter((b, i, arr) => arr.indexOf(b) === i)
          .slice(0, 3);
        next.push({ candidate: c, speechPitch: speech, bullets });
      }
      if (next.length) cards = next;
    }
  } catch {
    /* fallback already set */
  }

  const parts: string[] = [];
  if (spokenFlow && cards[0] && cards[1]) {
    parts.push(spokenFlow);
  } else if (cards[0] && cards[1]) {
    const intro =
      summary && (!opts.req.continueFromBridge || opts.softFail) ? summary : '';
    parts.push(
      weaveDualOptionSpoken({
        intro,
        continueFromBridge: Boolean(opts.req.continueFromBridge) && !opts.softFail,
        aName: cards[0].candidate.name,
        aPitch: cards[0].speechPitch,
        bName: cards[1].candidate.name,
        bPitch: cards[1].speechPitch,
      }),
    );
  } else if (cards[0]) {
    if (summary && (!opts.req.continueFromBridge || opts.softFail)) {
      parts.push(summary);
    }
    parts.push(cards[0].speechPitch);
    parts.push('Eine klare Alternative habe ich gerade nicht.');
  }

  if (cards[0] && cards[1]) {
    const d0 = cards[0].candidate.distFromAnchorM;
    const d1 = cards[1].candidate.distFromAnchorM;
    if (
      d0 != null &&
      d1 != null &&
      d0 > 2200 &&
      d1 < d0 * 0.7
    ) {
      parts.push(
        `${cards[1].candidate.name} liegt deutlich näher, falls dir das zu weit ist.`,
      );
    }
  }

  return {
    summary,
    cards,
    spokenText: parts.join(' ').replace(/\s+/g, ' ').trim(),
  };
}
