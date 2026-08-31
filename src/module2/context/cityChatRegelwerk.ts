/**
 * Stadt-Chat Regelwerk — Inject bei jedem Manager/Chat-Turn (kein Gemini-Fenster).
 * Stadt-agnostisch: Variablen aus Kontext, keine Orts-Hardcodes als Skript.
 */

import { foldCityKey } from '../../services/navigation/landmarkAliases';
import { formatThreadContextForPrompt } from '../../services/memory/conversationThreads';
import { resolveActiveCity, resolveCityChatScope } from '../context/placeContext';
import { getShortTerm } from '../context/shortTermContext';

export type CityChatRegelwerkInput = {
  userText?: string;
  cityHint?: string | null;
  cityKey?: string | null;
  navActive?: boolean;
  calendarOpen?: boolean;
};

function prefsLine(): string {
  try {
    const { getCachedUserProfile } = require('../../services/userProfileService') as {
      getCachedUserProfile: () => {
        displayName?: string | null;
        interests?: Record<string, string> | null;
        diet?: string[] | null;
      } | null;
    };
    const p = getCachedUserProfile();
    if (!p) return '';
    const bits: string[] = [];
    if (p.displayName?.trim()) bits.push(`User ${p.displayName.trim()}`);
    const diet = (p.diet || []).filter(Boolean).slice(0, 3);
    if (diet.length) bits.push(`Ernährung: ${diet.join(', ')}`);
    const interests = p.interests;
    if (interests && typeof interests === 'object') {
      const yes = Object.entries(interests)
        .filter(([, v]) => String(v).toLowerCase() === 'yes')
        .map(([k]) => k)
        .slice(0, 6);
      if (yes.length) bits.push(`Prefs ja: ${yes.join(', ')}`);
    }
    return bits.length ? `Profil: ${bits.join(' · ')}` : '';
  } catch {
    return '';
  }
}

function planLine(_userText?: string): string {
  try {
    const { formatCompactTimelineLine } = require('../timeline/timelineSnapshot') as {
      formatCompactTimelineLine: (dayKey?: string) => string;
    };
    return formatCompactTimelineLine();
  } catch {
    return '';
  }
}

/**
 * Kompakter Block für Manager-Prompt / Chat-Lane.
 * Wortlaut der Antwort bleibt frei — nur Struktur + Stadtgrenze.
 */
export function buildCityChatRegelwerk(input: CityChatRegelwerkInput = {}): string {
  const short = (() => {
    try {
      return getShortTerm();
    } catch {
      return null;
    }
  })();
  const cityLabel =
    (input.cityHint || '').trim() ||
    short?.lastMentionedCity ||
    resolveActiveCity() ||
    'unbekannt';
  const cityKey =
    (input.cityKey && foldCityKey(input.cityKey)) ||
    resolveCityChatScope(input.userText, null).cityKey ||
    foldCityKey(cityLabel) ||
    'unknown';

  const lines: string[] = [
    '=== STADT-CHAT REGELWERK (SSOT — kein Transcript-Dump) ===',
    `Stadt: ${cityLabel} (cityKey=${cityKey})`,
    'Grenze: Nur dieser Stadt-Chat. Keine Fakten/Hotels/Themen aus anderen Städten.',
    'Antwort-First: klare Lösung vorne; Tipps hinten. Bridge = Verstanden + Zusagen (kein Fakten-Spoil); nie nur leere „ich check/schau mal“-Floskel.',
    'Just-Do-It: Ergebnis + Buttons in derselben Antwort; keine Permission-Fragen außer echter Blockade.',
    'Wahrheit: Pitch/Nav/Pack/Live-Tools > Fantasie. Preise/Programm nur belegt.',
    'Multi-Intent: alle echten Aufträge behalten; Gelaber ignorieren.',
  ];

  const pref = prefsLine();
  if (pref) lines.push(pref);
  let skipStickyThread = false;
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    const { shouldScrubDeadThread, decideTopicCut } = require('../kernel/turnKernel') as {
      shouldScrubDeadThread: (m: string) => boolean;
      decideTopicCut: (o: {
        userText: string;
        foregroundLabel?: string | null;
        openLoop?: string | null;
        lastClosedTopic?: string | null;
      }) => string;
    };
    let openLoop: string | null = null;
    let lastClosed: string | null = null;
    try {
      const { getTopicCutContext } = require('../../services/memory/conversationThreads') as {
        getTopicCutContext: () => {
          openLoop: string | null;
          lastClosedTopic: string | null;
          foregroundLabel: string | null;
        };
      };
      const ctx = getTopicCutContext();
      openLoop = ctx.openLoop;
      lastClosed = ctx.lastClosedTopic;
    } catch {
      openLoop = short?.lastPlaceName || null;
    }
    const mode = decideTopicCut({
      userText: input.userText || '',
      foregroundLabel: short?.lastTopic || null,
      openLoop,
      lastClosedTopic: lastClosed,
    });
    skipStickyThread =
      wantsTaxiRide(input.userText || '') ||
      shouldScrubDeadThread(mode as never);
  } catch {
    try {
      const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
        wantsTaxiRide: (s: string) => boolean;
      };
      skipStickyThread = wantsTaxiRide(input.userText || '');
    } catch {
      skipStickyThread = false;
    }
  }
  const plan = skipStickyThread ? '' : planLine(input.userText);
  if (plan) lines.push(plan);
  if (!skipStickyThread && short?.lastPlaceName) {
    lines.push(`Letzter Ort im Chat: ${short.lastPlaceName}`);
  }
  if (!skipStickyThread && short?.lastTopic) {
    lines.push(`Thema: ${short.lastTopic}`);
  }
  if (input.navActive) lines.push('Nav läuft — keine parallele Fake-Route erfinden.');
  if (input.calendarOpen) {
    lines.push('Kalender/Plan offen — Tagesplan = Modul 5; Einzelwünsche = Concierge/Pitch.');
  }

  lines.push(
    'WEICHE: Zuerst DIESE User-Äußerung. Geparkte Threads nur bei klarem Bezug (gleiches Ziel/Thema). Uhrzeit+morgen allein ist kein Flug-Resume.',
  );
  // Topic-Cut / Taxi: keine geparkten Threads in den Prompt (sonst Leak wie Gurkenzeit→Papst).
  if (!skipStickyThread) {
    try {
      const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
        wantsTaxiRide: (s: string) => boolean;
      };
      if (!wantsTaxiRide(input.userText || '')) {
        const thread = formatThreadContextForPrompt({
          includeParkedIndex: true,
          maxParked: 4,
          cityKey,
        });
        if (thread) lines.push(thread);
      }
    } catch {
      try {
        const thread = formatThreadContextForPrompt({
          includeParkedIndex: true,
          maxParked: 4,
          cityKey,
        });
        if (thread) lines.push(thread);
      } catch {
        /* soft */
      }
    }
  }

  lines.push(
    'Dies sind Struktur-Regeln. Übernimm nie festen Wortlaut. Dynamisch an Stadt und Kontext anpassen.',
  );
  return lines.join('\n');
}
