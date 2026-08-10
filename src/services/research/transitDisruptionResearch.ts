/**
 * ÖPNV-Störungen / Bauarbeiten → ehrliche Lage + Alternativen.
 * Nutzt Journey-Plan + Web-Hints; nichts erfinden.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import { planJourney } from '../transit/journeyPlanner';
import { formatJourneyForConcierge } from '../transit/formatJourneyCard';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import type { Module2ActionButton } from '../../module2/types';
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../concierge/findusResponsePolicy';
import { geocodePlaceName } from '../navigation/googleMapsNav';

export type TransitDisruptionResult = {
  hasDisruption: boolean;
  alternativeOffered: boolean;
  spokenDraft: string;
  bullets: string[];
  buttons: Module2ActionButton[];
  promptBlock: string;
};

function extractDest(text: string): string | null {
  const m = text.match(
    /\b(?:nach|zum|zur|bis|Richtung)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]{2,}){0,3})/u,
  );
  return m?.[1]?.trim().slice(0, 60) ?? null;
}

async function webDisruptionHint(opts: {
  userText: string;
  dest: string | null;
  cityHint: string | null;
  signal?: AbortSignal;
}): Promise<{ disrupted: boolean; note: string; altHint: string | null }> {
  if (!hasGeminiApiKey()) {
    return { disrupted: false, note: 'no_gemini', altHint: null };
  }
  if (await isDeviceOffline()) {
    return { disrupted: false, note: 'offline', altHint: null };
  }
  const prompt = [
    'Du prüfst aktuelle ÖPNV-/Bahn-Störungen oder Bauarbeiten (Google Search).',
    `User: „${opts.userText.slice(0, 240)}“`,
    opts.dest ? `Ziel: ${opts.dest}` : '',
    opts.cityHint ? `Region: ${opts.cityHint}` : '',
    'Nur belegte Störungen. Wenn keine gefunden: disrupted=false.',
    'Wenn Störung: kurze note + altHint (z. B. Umstieg über Nachbarbahnhof / Bus / Ersatz).',
    FINDUS_FEW_SHOT_DISCLAIMER,
    'Nur JSON: {"disrupted":true|false,"note":"…","altHint":"…"|null}',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      enableGoogleSearch: true,
      maxTokens: 400,
      temperature: 0.1,
      useFindusSystem: false,
      signal: opts.signal,
    });
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return { disrupted: false, note: 'parse_fail', altHint: null };
    }
    const j = JSON.parse(raw.slice(start, end + 1)) as {
      disrupted?: boolean;
      note?: string;
      altHint?: string | null;
    };
    return {
      disrupted: Boolean(j.disrupted),
      note: String(j.note ?? '').slice(0, 200),
      altHint: j.altHint ? String(j.altHint).slice(0, 200) : null,
    };
  } catch {
    return { disrupted: false, note: 'research_fail', altHint: null };
  }
}

export async function researchTransitDisruption(opts: {
  userText: string;
  lat: number;
  lng: number;
  cityHint?: string | null;
  signal?: AbortSignal;
}): Promise<TransitDisruptionResult> {
  const destName = extractDest(opts.userText);
  const web = await webDisruptionHint({
    userText: opts.userText,
    dest: destName,
    cityHint: opts.cityHint ?? null,
    signal: opts.signal,
  });

  let destLat = opts.lat;
  let destLng = opts.lng;
  let resolved = destName || 'Ziel';
  if (destName) {
    const g = await geocodePlaceName(destName, {
      biasLat: opts.lat,
      biasLng: opts.lng,
      cityHint: opts.cityHint,
    });
    if (g) {
      destLat = g.lat;
      destLng = g.lng;
      resolved = g.label || destName;
    }
  }

  let journeySpeech = '';
  let bullets: string[] = [];
  const buttons: Module2ActionButton[] = [];
  let alternativeOffered = false;

  try {
    const plan = await planJourney({
      from: { lat: opts.lat, lng: opts.lng },
      to: { lat: destLat, lng: destLng },
      travelMode: 'transit',
      numItineraries: 3,
    });
    const best = plan.itineraries[0];
    const second = plan.itineraries[1];
    if (best) {
      const card = formatJourneyForConcierge(best, resolved);
      journeySpeech = card.speech;
      bullets = card.bullets.slice(0, 3);
      buttons.push({
        id: 'start_transit',
        label: shortenActionLabel('🚌 ÖPNV starten'),
        payload: {
          kind: 'ui',
          action: 'start_journey_nav',
          data: { dest: resolved },
        },
      });
      if (second && (web.disrupted || web.altHint)) {
        alternativeOffered = true;
        const altCard = formatJourneyForConcierge(second, resolved);
        bullets.push(`Alt: ${altCard.bullets[0] ?? 'andere Verbindung'}`);
        buttons.push({
          id: 'alt_transit',
          label: shortenActionLabel('🚌 Alternative'),
          payload: {
            kind: 'ui',
            action: 'prompt',
            data: {
              text: `Nimm die alternative ÖPNV-Verbindung zu ${resolved}`,
            },
          },
        });
      }
    } else if (web.disrupted) {
      bullets.push('Keine direkte ÖPNV-Verbindung gerade');
      alternativeOffered = true;
      buttons.push({
        id: 'taxi_fallback',
        label: shortenActionLabel('🚕 Taxi/Uber'),
        payload: {
          kind: 'ui',
          action: 'prompt',
          data: { text: `Taxi oder Uber nach ${resolved}` },
        },
      });
    }
  } catch {
    /* soft */
  }

  const spokenParts: string[] = [];
  if (web.disrupted) {
    spokenParts.push(
      web.note
        ? `Aktuell Störung/Bau: ${web.note}`
        : 'Aktuell gibt es eine Störung auf der direkten Verbindung.',
    );
    if (web.altHint) {
      spokenParts.push(`Alternative: ${web.altHint}`);
      alternativeOffered = true;
    }
  }
  if (journeySpeech) {
    spokenParts.push(
      web.disrupted
        ? `Trotzdem nutzbar / Umweg: ${journeySpeech}`
        : journeySpeech,
    );
  }
  if (!spokenParts.length) {
    spokenParts.push(
      destName
        ? `ÖPNV nach ${resolved} prüfe ich — konkrete Abfahrt folgt.`
        : 'ÖPNV-Lage checke ich kurz.',
    );
  }

  const promptBlock = [
    '=== ÖPNV STÖRUNG / VERBINDUNG ===',
    `disrupted=${web.disrupted}`,
    web.note ? `note=${web.note}` : '',
    web.altHint ? `altHint=${web.altHint}` : '',
    journeySpeech ? `journey=${journeySpeech}` : 'journey=none',
    'FLOW: Störung ehrlich → Alternative → Dauer → Buttons. Keine Fake-Direktverbindung.',
    FINDUS_FEW_SHOT_DISCLAIMER,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    hasDisruption: web.disrupted,
    alternativeOffered,
    spokenDraft: spokenParts.join(' ').slice(0, 900),
    bullets: bullets.slice(0, 3),
    buttons: buttons.slice(0, 4),
    promptBlock,
  };
}
