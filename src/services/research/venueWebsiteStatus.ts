/**
 * Website-Öffnungs-/Urlaub-Check — Praxis/Venue-Seiten kurz lesen.
 * Nichts erfinden: nur klare Signale aus dem Text; fail = unchecked.
 */

import { fetchPublicDocument } from './webFetch';

export type WebsiteVenueStatus = {
  checked: boolean;
  /** Starke Signale: Urlaub, Betriebsferien, „derzeit geschlossen“ */
  likelyClosedOrVacation: boolean;
  reason: string | null;
  /** Kurzer Beleg-Ausschnitt */
  evidence: string | null;
  url: string | null;
};

const VACATION_RE =
  /\b(urlaub|betriebsferien|praxisurlaub|geschlossen\s+wegen\s+urlaub|wegen\s+urlaub\s+geschlossen|derzeit\s+geschlossen|vor[üu]bergehend\s+geschlossen|bis\s+auf\s+weiteres\s+geschlossen| Vertretung\s+durch|vertreten\s+durch|keine\s+sprechstunde|sprechstundenfrei)\b/iu;

const OPEN_HINT_RE =
  /\b(heute\s+ge[öo]ffnet|jetzt\s+ge[öo]ffnet|notdienst|notfallpraxis|24\s*\/\s*7|rund\s+um\s+die\s+uhr)\b/iu;

function clipEvidence(text: string, idx: number): string {
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + 80);
  return text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Reine Text-Heuristik — für Tests ohne Netzwerk.
 */
export function analyzeWebsiteHoursText(
  text: string,
  opts?: { url?: string | null },
): WebsiteVenueStatus {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 40) {
    return {
      checked: false,
      likelyClosedOrVacation: false,
      reason: 'too_short',
      evidence: null,
      url: opts?.url ?? null,
    };
  }

  const vac = VACATION_RE.exec(t);
  // Urlaub/Betriebsferien schlägt „Notdienst“-Hinweise auf derselben Seite
  if (vac) {
    return {
      checked: true,
      likelyClosedOrVacation: true,
      reason: 'vacation_or_temp_closed',
      evidence: clipEvidence(t, vac.index),
      url: opts?.url ?? null,
    };
  }

  // Wochentag „geschlossen“ allein ist zu schwach ohne Kontext — nur „heute geschlossen“
  if (/\bheute\s+geschlossen\b/iu.test(t) && !OPEN_HINT_RE.test(t)) {
    const m = /\bheute\s+geschlossen\b/iu.exec(t);
    return {
      checked: true,
      likelyClosedOrVacation: true,
      reason: 'closed_today',
      evidence: m ? clipEvidence(t, m.index) : null,
      url: opts?.url ?? null,
    };
  }

  return {
    checked: true,
    likelyClosedOrVacation: false,
    reason: null,
    evidence: null,
    url: opts?.url ?? null,
  };
}

/**
 * Öffentliche Website laden und Status ableiten (Timeout kurz).
 */
export async function checkVenueWebsiteStatus(
  url: string | null | undefined,
  opts?: { signal?: AbortSignal },
): Promise<WebsiteVenueStatus> {
  const clean = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(clean)) {
    return {
      checked: false,
      likelyClosedOrVacation: false,
      reason: 'no_url',
      evidence: null,
      url: null,
    };
  }
  try {
    if (opts?.signal?.aborted) {
      return {
        checked: false,
        likelyClosedOrVacation: false,
        reason: 'aborted',
        evidence: null,
        url: clean,
      };
    }
    const doc = await fetchPublicDocument(clean);
    if (!doc.ok || !doc.text) {
      return {
        checked: false,
        likelyClosedOrVacation: false,
        reason: doc.reason ?? 'fetch_fail',
        evidence: null,
        url: clean,
      };
    }
    return analyzeWebsiteHoursText(doc.text, { url: clean });
  } catch {
    return {
      checked: false,
      likelyClosedOrVacation: false,
      reason: 'fetch_error',
      evidence: null,
      url: clean,
    };
  }
}
