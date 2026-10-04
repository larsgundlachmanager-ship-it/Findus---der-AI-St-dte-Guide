/**
 * Outfit/Wetter-UI: keine Touren/Nav-Buttons, Stichpunkte = FACT-Chips (kein Fließtext).
 */
import type { QuickAction } from '../../types/concierge';
import { clampVisualBullets } from '../../services/concierge/visualBullets';

const TOUR_ACTION_RE =
  /\b(touren\s+suchen|getyourguide|musement|viator|klook|tiqets|wegotrip|gocity|open_gyg)\b/iu;

const OUTFIT_CLAUSE_RE =
  /\b(jacke|pulli|pullover|hoodie|regenjacke|windjacke|schirm|regenschirm|schicht|kleidung|anziehen|mitnehm|dünne|duenne|warm|kalt|frieren|sonne|schutz)\b/iu;

/** Prosa-Satz-Opener — nie als Spickzettel-Chip. */
const PROSE_BULLET_RE =
  /^(?:also|gerade|heute|morgen|abend|nacht|in\s+\p{L}+|es\s+(?:sieht|wird|ist)|liegst\s+du|schau|lass\s+uns)\b/iu;

export function isOutfitWeatherTurn(userText?: string | null, cardTitle?: string | null): boolean {
  try {
    const { looksLikeOutfitOrWeatherUtterance } = require('../../module2/planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
    };
    const t = String(userText ?? '').trim();
    if (t && looksLikeOutfitOrWeatherUtterance(t)) return true;
  } catch {
    /* soft */
  }
  return /^\s*(?:wetter|regen)\b/iu.test(String(cardTitle ?? ''));
}

export function looksLikeRainAsk(userText?: string | null): boolean {
  const t = String(userText ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\b(regnet|regnen|regen|regnerisch|niederschlag|schauer|giessen|gießen)\b/iu.test(t) &&
    !/\b(anziehen|outfit|kleidung|was\s+soll\s+ich\s+an)\b/iu.test(t)
  );
}

export function stripOutfitWeatherTourActions(actions: QuickAction[]): QuickAction[] {
  return actions.filter((a) => {
    if (a.type === 'OPEN_GYG_WIDGET') return false;
    if (a.type === 'START_NAVIGATION') return false;
    const blob = `${a.label ?? ''} ${a.type} ${a.payload?.url ?? ''}`;
    return !TOUR_ACTION_RE.test(blob);
  });
}

function looksLikeFactChip(raw: string): boolean {
  const b = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!b || b.length < 3 || b.length > 48) return false;
  if (/[.!?]$/.test(b) && b.split(/\s+/).length >= 8) return false;
  if (PROSE_BULLET_RE.test(b) && b.split(/\s+/).length >= 6) return false;
  // Chips: Grad, Himmel, Regen, kurze Kleidung
  if (/\d+\s*°|\d+\s*grad|%|regen|trocken|wechselhaft|bewölkt|bewoelkt|sonnig|wolken|schauer|gewitter|jacke|schirm|pulli/iu.test(b)) {
    return true;
  }
  if (b.includes('·') || b.includes('–') || b.includes('-')) return true;
  return b.split(/\s+/).length <= 6;
}

function stripProseLead(s: string): string {
  return s
    .replace(
      /^(?:also[,:]?\s*|gerade[,:]?\s*|heute[,:]?\s*|in\s+[\p{L}'-]{2,24}\s+(?:sieht\s+es\s+so\s+aus[,:]?\s*)?)/iu,
      '',
    )
    .replace(/\bliegst\s+du\s+bei\b/iu, '')
    .replace(/\bsieht\s+es\s+so\s+aus[,:]?\s*/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kompakte Wetter-/Outfit-Chips aus Speech — kein voller Satz-Dump. */
export function deriveWeatherFactChips(
  speech: string,
  opts?: { maxCount?: number; userText?: string | null },
): string[] {
  const maxCount = Math.max(1, opts?.maxCount ?? 3);
  const rainAsk = looksLikeRainAsk(opts?.userText);
  const text = String(speech ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const chips: string[] = [];
  const push = (c: string) => {
    const t = stripProseLead(c)
      .replace(/[.!?]+$/u, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || t.length < 3 || t.length > 42) return;
    if (!looksLikeFactChip(t) && t.split(/\s+/).length > 7) return;
    const key = t.toLowerCase();
    if (chips.some((x) => x.toLowerCase() === key || x.toLowerCase().includes(key))) {
      return;
    }
    chips.push(t);
  };

  // Regen zuerst bei Regen-Frage
  const rainWin = text.match(
    /\b(?:regen|schauer)\s+(?:ab|gegen|um|gegen)\s+(\d{1,2}[:.]\d{2}|\d{1,2}\s*uhr)/iu,
  );
  if (rainWin?.[1]) {
    push(`Regen ab ${rainWin[1].replace(/\s*uhr/iu, '').trim()}`);
  } else if (/\b(?:kein(?:en)?\s+regen|bleibt\s+trocken|trocken\b|ohne\s+regen)\b/iu.test(text)) {
    push(rainAsk ? 'Heute kein Regen' : 'trocken');
  } else if (/\b(?:regnet|regen|schauer|niederschlag)\b/iu.test(text)) {
    const prob = text.match(/\b(\d{1,3})\s*(?:%|prozent)\b/iu);
    if (prob) push(`Regen ${prob[1]}%`);
    else if (/\b(?:später|spaeter|abend|nachmittag)\b/iu.test(text)) push('Regen später');
    else push('Regen möglich');
  }

  const tempRange = text.match(
    /\b(?:von\s+)?(\d{1,2})\s*(?:bis|–|-|—)\s*(\d{1,2})\s*(?:°|grad)\b/iu,
  );
  const highOnly = text.match(
    /\b(?:bis|höchstens|hoechstens|spitze|um\s+die)\s+(\d{1,2})\s*(?:°|grad)\b/iu,
  );
  const nowTemp = text.match(
    /\b(?:gerade|jetzt|aktuell)?\s*(?:bei\s+)?(\d{1,2})\s*(?:°|grad)\b/iu,
  );
  if (!rainAsk || chips.length < 2) {
    if (tempRange) {
      push(`${tempRange[1]}–${tempRange[2]}°`);
    } else if (highOnly) {
      push(`bis ${highOnly[1]}°`);
    } else if (nowTemp) {
      push(`${nowTemp[1]}°`);
    }
  }

  const sky =
    text.match(
      /\b(wechselhaft|bewölkt|bewoelkt|bedeckt|sonnig|klar|wolkig|neblig|nebelig|windig)\b/iu,
    )?.[1] ?? null;
  if (sky && (!rainAsk || chips.length < 2)) {
    const skyLabel = sky.charAt(0).toUpperCase() + sky.slice(1);
    const hi = highOnly?.[1] ?? tempRange?.[2];
    // Prefer one woven chip when both sky + high known and no temp chip yet
    if (hi && !chips.some((c) => /°/.test(c))) {
      push(`${skyLabel} · bis ${hi}°`);
    } else if (!chips.some((c) => c.toLowerCase().includes(sky.toLowerCase()))) {
      push(skyLabel);
    }
  }

  const outfitAskForChips =
    /\b(anziehen|outfit|kleidung|was\s+soll\s+ich\s+an|was\s+zieh)\b/iu.test(
      String(opts?.userText ?? ''),
    );
  if (!rainAsk && outfitAskForChips) {
    const outfitBits = text
      .split(/(?<=[.!?])\s+|,\s+/)
      .map((s) => s.trim())
      .filter((c) => OUTFIT_CLAUSE_RE.test(c) && c.length >= 8 && c.length <= 80);
    for (const clause of outfitBits) {
      let tip = stripProseLead(clause)
        .replace(/^(?:nimm|nehm|pack|zieh)\s+/iu, '')
        .replace(/\b(eine|einen|ein|die|der|das)\s+/giu, '')
        .replace(/[.!?]+$/u, '')
        .trim();
      if (/\bjacke\b/iu.test(tip)) tip = tip.match(/\b(?:dünne|duenne|leichte|warme|regen)?\s*jacke\b/iu)?.[0] ?? 'Jacke';
      else if (/\bschirm|regenschirm\b/iu.test(tip)) tip = 'Schirm';
      else if (/\bpulli|hoodie\b/iu.test(tip)) tip = tip.match(/\b(?:leichter\s+)?(?:pulli|hoodie)\b/iu)?.[0] ?? 'Pulli';
      else if (tip.split(/\s+/).length > 5) continue;
      if (tip) push(tip.charAt(0).toUpperCase() + tip.slice(1));
      if (chips.length >= maxCount) break;
    }
  }

  return chips.slice(0, maxCount);
}

function isTomorrowTimelineChip(raw: string): boolean {
  const b = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!b) return false;
  return (
    /🌡/.test(b) ||
    /\b\d{1,2}\s*°\s*bis\s*\d{1,2}\s*°/.test(b) ||
    /\b(?:bis|ab)\s+\d{1,2}\s*Uhr\b/iu.test(b)
  );
}

export function finalizeOutfitWeatherBullets(
  bullets: string[],
  speech: string,
  opts?: { userText?: string | null },
): string[] {
  const timeline = (bullets ?? [])
    .map((b) => String(b ?? '').replace(/\s+/g, ' ').trim())
    .filter(isTomorrowTimelineChip);
  if (timeline.length >= 2) return timeline.slice(0, 4);

  const rainAsk = looksLikeRainAsk(opts?.userText);
  const outfitAsk =
    /\b(anziehen|outfit|kleidung|was\s+soll\s+ich\s+an|was\s+zieh)\b/iu.test(
      String(opts?.userText ?? ''),
    );
  const existingChips = (bullets ?? [])
    .map((b) => String(b ?? '').replace(/\s+/g, ' ').trim())
    .filter((b) => looksLikeFactChip(b))
    .filter((b) => outfitAsk || !OUTFIT_CLAUSE_RE.test(b));

  const fromSpeech = deriveWeatherFactChips(speech, {
    maxCount: 3,
    userText: opts?.userText,
  });

  let base: string[] =
    existingChips.length >= 1
      ? existingChips
      : fromSpeech.length > 0
        ? fromSpeech
        : [];

  // Regen-Frage: Regen-Chip zuerst, max 2, kein Outfit-Essay
  if (rainAsk) {
    base = [...base].sort((a, b) => {
      const aRain = /regen|trocken|schauer/i.test(a) ? 0 : 1;
      const bRain = /regen|trocken|schauer/i.test(b) ? 0 : 1;
      return aRain - bRain;
    });
    // Optional Temp als 2. Chip
    base = base.slice(0, 2);
  } else {
    base = base.slice(0, 3);
  }

  if (base.length === 0 && fromSpeech.length) base = fromSpeech.slice(0, rainAsk ? 2 : 3);

  let out = clampVisualBullets(base, {
    userText: opts?.userText,
    speechText: speech,
    maxCount: rainAsk ? 2 : 3,
    maxChars: 42,
  });
  // clamp sortet nach Zahlen — Regen-Frage: Regen/Trocken wieder nach vorne
  if (rainAsk && out.length > 1) {
    out = [...out].sort((a, b) => {
      const aRain = /regen|trocken|schauer/i.test(a) ? 0 : 1;
      const bRain = /regen|trocken|schauer/i.test(b) ? 0 : 1;
      return aRain - bRain;
    });
  }
  return out;
}
