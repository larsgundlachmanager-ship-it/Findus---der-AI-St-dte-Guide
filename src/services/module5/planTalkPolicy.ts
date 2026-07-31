/**
 * Modul-5 Gesprächspolitik nach Plan-Eingabe — Klartext-Rückfragen.
 * SSOT für „Alles klar“ / Shop / Flug / Essen / Weg / Kompass.
 */

import type { QuickAction } from '../../types/concierge';
import type { LongFormPlanExtract } from './longFormPlanExtractor';

/** Ab dieser Fußweg-Dauer Taxi/ÖPNV anbieten (User fragt oft schon bei ~20 Min). */
export const ASK_TRANSIT_WALK_MIN = 20;

export type PlanTalkResult = {
  speech: string;
  actions: QuickAction[];
  kind:
    | 'all_clear'
    | 'clarify_shop'
    | 'clarify_flight'
    | 'clarify_meal'
    | 'clarify_nav'
    | 'clarify_transit'
    | 'clarify_time'
    | 'clarify_generic';
};

function hasIntent(text: string, re: RegExp): boolean {
  return re.test(text);
}

/**
 * Baut gesprochene Rückfrage / Bestätigung nach Commit.
 */
export function buildPlanTalkAfterCommit(opts: {
  extract: LongFormPlanExtract;
  transcript: string;
  /** Geschätzte Fußminuten zum nächsten Stop (optional) */
  walkMinToNext?: number | null;
  /** User will „jetzt gleich“ hin */
  goNow?: boolean;
}): PlanTalkResult {
  const t = opts.transcript;
  const ex = opts.extract;
  const walk = opts.walkMinToNext ?? null;

  // Explizite Klärfrage aus Extraktor hat Vorrang
  if (ex.clarifyingQuestion?.trim()) {
    return {
      kind: 'clarify_generic',
      speech: ex.clarifyingQuestion.trim(),
      actions: [],
    };
  }

  // Flug ohne Nummer
  const flightish =
    ex.deadlines.some((d) => d.kind === 'flight' && !d.flightOrTrainCode) ||
    hasIntent(t, /\b(fliegen|flug|abflug|einchecken|laden\s+um|boarding)\b/iu);
  if (
    flightish &&
    !ex.deadlines.some((d) => d.kind === 'flight' && d.flightOrTrainCode)
  ) {
    return {
      kind: 'clarify_flight',
      speech:
        'Alles notiert. Hast du eine Flugnummer für mich? Dann kann ich dir nützliche Infos geben.',
      actions: [
        {
          type: 'SHOW_MORE',
          label: 'Flugnummer sagen',
          payload: { textPrompt: 'Meine Flugnummer ist ' },
        },
      ],
    };
  }

  // Shoppen ohne Ort/Zeit
  const shop =
    hasIntent(t, /\b(shoppen|einkaufen|shopping|bummeln)\b/iu) ||
    ex.stops.some((s) => /shop|einkauf|bummel/i.test(s.label)) ||
    (ex as { blocks?: Array<{ label: string }> }).blocks?.some((b) =>
      /shop|einkauf|bummel/i.test(b.label),
    );
  const shopHasWhereWhen =
    ex.stops.some(
      (s) =>
        /shop|einkauf|bummel/i.test(s.label) &&
        (s.timeLocal || (s.notes && s.notes.length > 3)),
    ) || hasIntent(t, /\b(um\s+\d{1,2}|nachmittags|vormittags|in\s+der\s+[A-ZÄÖÜ])/iu);
  if (shop && !shopHasWhereWhen) {
    return {
      kind: 'clarify_shop',
      speech:
        'Alles klar — Shoppen ist im Plan. Hast du was Spezielles im Kopf, wo und wann du shoppen möchtest?',
      actions: [
        {
          type: 'SHOW_MORE',
          label: 'Ort & Zeit sagen',
          payload: {
            textPrompt: 'Ich möchte shoppen bei … um … Uhr',
          },
        },
      ],
    };
  }

  // Essen → Reservierung / Speisekarte
  const meal =
    hasIntent(t, /\b(essen|restaurant|abendessen|mittagessen|café|cafe)\b/iu) ||
    ex.stops.some((s) => /essen|restaurant|café|cafe/i.test(s.label)) ||
    ex.deadlines.some((d) => d.kind === 'reservation');
  if (meal) {
    const place =
      ex.stops.find((s) => /essen|restaurant|café|cafe/i.test(s.label))
        ?.label ?? 'dem Restaurant';
    return {
      kind: 'clarify_meal',
      speech: `Alles klar. Wollt ihr da essen gehen — soll ich dir einen Tisch reservieren oder die Speisekarte zeigen lassen?`,
      actions: [
        {
          type: 'SHOW_MORE',
          label: 'Tisch reservieren',
          payload: {
            textPrompt: `Reserviere einen Tisch bei ${place}`,
          },
        },
        {
          type: 'SHOW_MORE',
          label: 'Speisekarte',
          payload: {
            textPrompt: `Zeig mir die Speisekarte von ${place}`,
          },
        },
      ],
    };
  }

  // Jetzt gleich hin → Kompass / Weg
  const goNow =
    opts.goNow === true ||
    hasIntent(t, /\b(jetzt\s+gleich|sofort\s+hin|los\s+zum|kannst\s+du\s+(mir\s+)?(den\s+)?weg|kompass)\b/iu);
  if (goNow) {
    return {
      kind: 'clarify_nav',
      speech:
        'Alles klar — kennt ihr den Weg, oder soll ich den Kompass starten?',
      actions: [
        {
          type: 'SHOW_MORE',
          label: 'Kompass starten',
          payload: { textPrompt: 'Startet die Navigation / den Kompass dorthin' },
        },
        {
          type: 'SHOW_MORE',
          label: 'Kenn den Weg',
          payload: { textPrompt: 'Ich kenne den Weg, kein Navi nötig' },
        },
      ],
    };
  }

  // Langer Fußweg → Taxi / ÖPNV (schon ab ~20 Min)
  if (walk != null && walk >= ASK_TRANSIT_WALK_MIN) {
    return {
      kind: 'clarify_transit',
      speech: `Alles klar. Zu Fuß wären das so um die ${walk} Minuten — soll ich Taxi oder ÖPNV prüfen?`,
      actions: [
        {
          type: 'SHOW_MORE',
          label: 'ÖPNV prüfen',
          payload: { textPrompt: 'Zeig mir die ÖPNV-Verbindung dorthin' },
        },
        {
          type: 'SHOW_MORE',
          label: 'Taxi',
          payload: { textPrompt: 'Organisiere ein Taxi dorthin' },
        },
        {
          type: 'SHOW_MORE',
          label: 'Zu Fuß ok',
          payload: { textPrompt: 'Zu Fuß ist ok' },
        },
      ],
    };
  }

  // Unsichere Punkte ohne Uhr
  const uncertain = [...ex.deadlines, ...ex.stops].find(
    (x) => x.confidence === 'uncertain' && !('timeLocal' in x && x.timeLocal),
  );
  if (uncertain) {
    return {
      kind: 'clarify_time',
      speech: `Alles notiert. Um wie viel Uhr genau wolltest du zu „${uncertain.label}"?`,
      actions: [],
    };
  }

  const n =
    ex.deadlines.length +
    ex.stops.length +
    ex.todos.length +
    ((ex as { blocks?: unknown[] }).blocks?.length ?? 0);
  if (n === 0) {
    return {
      kind: 'clarify_generic',
      speech:
        'Hab ich gehört — soll ich daraus konkrete Punkte im Plan machen, oder fehlt noch Ort oder Uhrzeit?',
      actions: [],
    };
  }

  return {
    kind: 'all_clear',
    speech:
      n === 1
        ? 'Alles klar — der Punkt steht im Plan.'
        : `Alles klar — ${n} Punkte stehen im Plan.`,
    actions: [],
  };
}
