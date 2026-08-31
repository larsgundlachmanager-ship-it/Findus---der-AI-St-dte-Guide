/**
 * Lockscreen / tray copy: short teaser that invites a tap.
 * Full message stays in notification data / pending speech.
 */

import type { HudTipKind } from '../ui/proactiveHudEngine';

export type PushTeaser = {
  title: string;
  body: string;
};

const MAX_BODY = 88;

function clip(s: string, max = MAX_BODY): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Extract rough rain minutes from tip / speech text. */
function rainMinutesFrom(text: string): number | null {
  const m = text.match(/(\d+)\s*min/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function buildHudTipPushTeaser(opts: {
  kind: HudTipKind;
  text: string;
  meta?: string;
}): PushTeaser {
  const mins = rainMinutesFrom(opts.text) ?? rainMinutesFrom(opts.meta ?? '');

  switch (opts.kind) {
    case 'weather_rain':
      if (mins != null && mins <= 8) {
        return {
          title: 'Yorro',
          body: "Hey — gleich wird's nass. Hast du's auf dem Schirm?",
        };
      }
      if (mins != null && mins <= 35) {
        return {
          title: 'Yorro',
          body: 'Bald Regen — sollen wir kurz irgendwo reingehen?',
        };
      }
      return {
        title: 'Yorro',
        body: 'Wetter-Hinweis: Bald könnte es regnen. Tippen für Details.',
      };

    case 'weather_summary':
      return {
        title: 'Yorro',
        body: clip(
          opts.text.length > 12
            ? `Kurzer Wetter-Check: ${opts.text.replace(/^🌧\s*/u, '')}`
            : 'Kurzer Wetter-Check — tippen für mehr.',
        ),
      };

    case 'session_deadline':
      return {
        title: 'Yorro',
        body: clip(
          /losgeh|losgehen|leave/i.test(opts.text)
            ? `Zeit zum Losgehen: ${opts.text.replace(/^→\s*/u, '')}`
            : `Termin im Blick: ${opts.text}`,
        ),
      };

    case 'shopping_closing':
      return {
        title: 'Yorro',
        body: 'Supermärkte machen bald zu — noch was holen?',
      };

    case 'hotel_checkin':
      return {
        title: 'Yorro',
        body: 'Check-in naht — tippen, wenn du den Hinweis brauchst.',
      };

    case 'hotel_breakfast':
      return {
        title: 'Yorro',
        body: 'Frühstückszeit? Kurzer Reminder von Yorro.',
      };

    case 'weather_heat':
      return {
        title: 'Yorro',
        body: clip(
          opts.text.length > 8
            ? opts.text
            : 'Heiß draußen — Sonnencreme / Wasser im Blick?',
        ),
      };

    case 'luggage_drop':
      return {
        title: 'Yorro · Gepäck',
        body: clip(
          opts.meta
            ? `${opts.text.replace(/^🧳\s*/u, '')} · ${opts.meta}`
            : opts.text || 'Gepäck vor dem Flug klären?',
        ),
      };

    case 'umbrella_day':
      return {
        title: 'Yorro',
        body: clip(opts.text || 'Später Regen — Schirm einpacken?'),
      };

    case 'sunset_tip':
      return {
        title: 'Yorro',
        body: clip(opts.text || 'Sonnenuntergang bald — schöner Spot?'),
      };

    case 'free_slot':
      return {
        title: 'Yorro',
        body: clip(opts.text || 'Zeitlücke — Vorschlag tippen.'),
      };

    case 'nice_tip':
      return {
        title: 'Yorro',
        body: clip(opts.text || 'Kurzer Tipp — tippen für mehr.'),
      };

    case 'open_task':
      return {
        title: 'Yorro',
        body: clip(`Offene Sache: ${opts.text}`),
      };

    default:
      return {
        title: 'Yorro',
        body: clip(opts.text || 'Kurzer Hinweis — tippen für mehr.'),
      };
  }
}

/**
 * Teaser when speech is deferred to a lockscreen notification.
 * Never dump the full script — invite the tap.
 */
export function buildSpeechPushTeaser(
  text: string,
  kind: 'assistant' | 'nav' | 'reminder',
): PushTeaser {
  const clean = text.replace(/\s+/g, ' ').trim();
  const lower = clean.toLowerCase();

  if (
    /regen|nass|schauer|niederschlag|regnen/.test(lower) ||
    kind === 'reminder' && /wetter|café|cafe|indoor/.test(lower)
  ) {
    const mins = rainMinutesFrom(clean);
    if (mins != null && mins <= 8) {
      return {
        title: 'Yorro · Wetter',
        body: "Hey — gleich wird's nass. Hast du's auf dem Schirm?",
      };
    }
    return {
      title: 'Yorro · Wetter',
      body: 'Bald Regen — tippen, dann sag ich dir den Plan.',
    };
  }

  if (kind === 'nav' || /navig|abbiegen|links|rechts|meter/.test(lower)) {
    return {
      title: 'Yorro · Navigation',
      body: 'Kurzer Navi-Hinweis — tippen zum Anhören.',
    };
  }

  if (
    kind === 'reminder' ||
    /aufbruch|losgeh|flug|bahn|bus|check-?in|timer|wecker/.test(lower)
  ) {
    return {
      title: 'Yorro · Erinnerung',
      body: clip(
        clean.length > 40
          ? 'Erinnerung wartet — tippen, dann hörst du den Rest.'
          : clean || 'Erinnerung von Yorro — tippen zum Anhören.',
      ),
    };
  }

  return {
    title: 'Yorro möchte dir etwas sagen',
    body: clip(
      clean.length > 50
        ? 'Kurzer Hinweis — tippen, dann erzähl ich’s dir.'
        : clean || 'Tipp zum Anhören — tippen.',
    ),
  };
}

export type TravelPushKind =
  | 'delay'
  | 'gate'
  | 'boarding'
  | 'cancel'
  | 'train'
  | 'flight';

/** Lockscreen: fact first (airport glance), tap speaks the rest. */
export function buildTravelPushTeaser(opts: {
  kind: TravelPushKind;
  title: string;
  body: string;
}): PushTeaser {
  const title = clip(opts.title.replace(/\s+/g, ' ').trim() || 'Yorro · Reise', 42);
  const body = clip(opts.body.replace(/\s+/g, ' ').trim(), 96);
  if (body) return { title, body };
  switch (opts.kind) {
    case 'delay':
      return { title, body: 'Verspätung — tippen zum Anhören.' };
    case 'gate':
      return { title, body: 'Gate-Wechsel — tippen zum Anhören.' };
    case 'boarding':
      return { title, body: 'Boarding — tippen zum Anhören.' };
    case 'cancel':
      return { title, body: 'Flug fällt aus — tippen zum Anhören.' };
    case 'train':
      return { title, body: 'Zug gleich da — tippen zum Anhören.' };
    default:
      return { title, body: 'Reise-Hinweis — tippen zum Anhören.' };
  }
}

/** Full line for after tap / in-app (HUD tip → spoken). */
export function buildHudTipFullLine(opts: {
  text: string;
  meta?: string;
}): string {
  const text = opts.text.replace(/\s+/g, ' ').trim();
  const meta = opts.meta?.replace(/\s+/g, ' ').trim();
  // Keep meta only if it adds a human suggestion, not cold labels like "Wetter"
  if (!meta) return text;
  if (/^(wetter|erinnerung|termin|task)$/i.test(meta)) return text;
  if (/café|cafe|indoor|los|einkauf|hotel|frühstück|fruehstueck/i.test(meta)) {
    return `${text}. ${meta.replace(/\s*·\s*wetter$/i, '').trim()}`.trim();
  }
  return text;
}
