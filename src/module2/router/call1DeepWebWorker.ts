/**
 * Deep-Web Worker — Optionen + Buchungslinks (Insel-Flug, Charter, …).
 * SSOT: webResearchService.runWebResearch — keine Fake-Preise/Links.
 */

export type DeepWebBookingOption = {
  title: string;
  summary: string;
  priceLabel?: string | null;
  url: string | null;
  source?: string | null;
};

export type DeepWebResearchResult = {
  ok: boolean;
  query: string;
  options: DeepWebBookingOption[];
  spokenDraft: string;
  bullets: string[];
  buttons: Array<{ id: string; label: string; url: string }>;
  promptBlock: string;
  /** until_evidence: wie oft wirklich gesucht wurde */
  passes?: number;
  queries?: string[];
};

export type DeepWebSearchHit = {
  facts?: Array<{
    label?: string;
    value?: string;
    place?: string | null;
    sourceUrl?: string | null;
  }>;
  sources?: Array<{ url?: string; title?: string; kind?: string }>;
  formPrefill?: { actionUrl?: string | null; purpose?: string } | null;
  speechHint?: string | null;
  researchNotes?: string;
};

export type DeepWebSearchFn = (query: string) => Promise<DeepWebSearchHit | null>;

/** Query-Schärfung für den nächsten Suchlauf (kein Orts-Hardcode). */
export function refineDeepWebQuery(
  base: string,
  pass: number,
  extras?: {
    cityHint?: string | null;
    mustKeys?: string[] | null;
    namedTitle?: string | null;
    wantBookingLink?: boolean;
  },
): string {
  const city = String(extras?.cityHint || '').trim();
  const musts = (extras?.mustKeys ?? [])
    .map((k) => String(k || '').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  const b = String(base || '').replace(/\s+/g, ' ').trim();
  if (pass <= 0) return b.slice(0, 280);
  if (pass === 1) {
    if (extras?.namedTitle) {
      return `${extras.namedTitle} offizielle Seite buchen Ticket Reservierung URL ${city} ${musts}`
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);
    }
    return `${b} offizielle Buchungs-URL kaufen Reservierung ${city}`
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 280);
  }
  return [musts || b, city, extras?.wantBookingLink ? 'Buchungslink Ticket Reservieren offiziell' : 'Website Kontakt Beleg']
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

export function deepWebNeedsAnotherPass(opts: {
  wantBookingLink?: boolean;
  optionCount: number;
  buttonCount: number;
}): boolean {
  if (opts.wantBookingLink) return opts.buttonCount < 1;
  return opts.optionCount < 1;
}

export function looksLikeDeepWebManagerTask(
  task: { id?: string; brief?: string; lane?: string },
  _userText?: string,
): boolean {
  const blob = `${task.id || ''} ${task.brief || ''}`;
  return /deep_web|wantBookingLink|Buchungs-URL|Live-Web/i.test(blob);
}

export function deepWebTaskBudgetMs(opts?: {
  researchBudgetSec?: number | null;
}): number {
  const fromSec = Number(opts?.researchBudgetSec);
  if (Number.isFinite(fromSec) && fromSec >= 20) {
    return Math.min(60_000, Math.max(20_000, Math.round(fromSec * 1000)));
  }
  return 45_000;
}

function mergeDeepWebOptions(
  a: DeepWebBookingOption[],
  b: DeepWebBookingOption[],
): DeepWebBookingOption[] {
  const out: DeepWebBookingOption[] = [];
  const seen = new Set<string>();
  for (const o of [...a, ...b]) {
    const key = (o.url || o.title).toLowerCase().slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  out.sort((x, y) => Number(Boolean(y.url)) - Number(Boolean(x.url)));
  return out.slice(0, 5);
}

export function looksLikeIslandFlight(text: string): boolean {
  return (
    /\b(wangerooge|juist|norderney|langeoog|baltrum|spiekeroog|borkum|helgoland)\b/iu.test(
      text || '',
    ) && /\b(flug|fliegen|flieger|charter|insel|ticket)\b/iu.test(text || '')
  );
}

export function wantsDeepWebBooking(text: string): boolean {
  const t = text || '';
  if (looksLikeIslandFlight(t)) return true;
  if (
    /\b(charter|buchungslink|ticket\s+buchen|flug\s+buchen|online\s+buchen|reservier|vorbestell|hop[\s-]?on|hop[\s-]?off|esim|e[\s-]?sim|roaming|schließfach|schliessfach|gepäckaufbewahrung|gepaeckaufbewahrung|bounce\b|museumsticket|eintrittskarte)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return (
    (/\b(flug|fliegen|ticket|fähre|faehre)\b/iu.test(t) &&
      /\b(insel|charter|privat)\b/iu.test(t))
  );
}

export type ShapeDeepWebExtras = {
  authorIntent?: string | null;
  mustKeys?: string[] | null;
  needBookingLink?: boolean;
  needTicket?: boolean;
  cityHint?: string | null;
};

/** Query-Shaping aus Absicht/Mission — Insel/Charter bleibt Spezialfall derselben Blaupause. */
export function shapeDeepWebQuery(
  userText: string,
  cityHint?: string | null,
  extras?: ShapeDeepWebExtras | null,
): string {
  const q = (userText || '').replace(/\s+/g, ' ').trim();
  const city = (extras?.cityHint ?? cityHint ?? '').trim();

  if (looksLikeIslandFlight(q)) {
    const island =
      q.match(
        /\b(wangerooge|juist|norderney|langeoog|baltrum|spiekeroog|borkum|helgoland)\b/iu,
      )?.[1] || 'Nordseeinsel';
    return `${island} Charter Flug Festland Ticket buchen${city ? ` ab ${city}` : ''}`.trim();
  }

  if (/\b(esim|e[\s-]?sim|roaming|daten\s+(?:im\s+)?ausland|sim[\s-]?karte)\b/iu.test(q)) {
    return `eSIM mobile Daten ${city || 'Reise'} kaufen offiziell Airalo Yesim`.trim();
  }
  if (
    /\b(schließfach|schliessfach|gepäck(?:aufbewahrung)?|gepaeck|koffer\s+abstellen|bounce)\b/iu.test(
      q,
    )
  ) {
    return `Gepäck Aufbewahrung Schließfach buchen ${city} Bounce Radical`.replace(
      /\s+/g,
      ' ',
    ).trim();
  }
  if (/\b(hop[\s-]?on|hop[\s-]?off|tagesticket|tageskarte)\b/iu.test(q)) {
    return `${q} Ticket kaufen offizielle Seite ${city}`.replace(/\s+/g, ' ').trim().slice(0, 280);
  }
  if (/\b(wechselstube|geldwechsel|euro\s+wechseln)\b/iu.test(q)) {
    return `Wechselstube Geld wechseln ${city || 'Nähe'} Adresse Öffnung`.trim();
  }

  const parts: string[] = [q];
  const intent = String(extras?.authorIntent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  if (intent && !q.toLowerCase().includes(intent.slice(0, 24).toLowerCase())) {
    parts.push(intent);
  }
  const musts = (extras?.mustKeys ?? [])
    .map((k) => String(k || '').trim())
    .filter(Boolean)
    .slice(0, 6);
  if (musts.length) parts.push(musts.join(' '));
  if (city) parts.push(city);

  const wantBook =
    extras?.needBookingLink ||
    extras?.needTicket ||
    wantsDeepWebBooking(q) ||
    /\b(buchen|ticket|reserv|link)\b/iu.test(q);
  if (wantBook) {
    parts.push('offizielle Seite Ticket buchen Buchungslink');
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 280) || q;
}

function optionsFromResearch(result: {
  facts?: Array<{
    label?: string;
    value?: string;
    place?: string | null;
    sourceUrl?: string | null;
  }>;
  sources?: Array<{ url?: string; title?: string; kind?: string }>;
  formPrefill?: { actionUrl?: string | null; purpose?: string } | null;
  speechHint?: string | null;
  researchNotes?: string;
}): DeepWebBookingOption[] {
  const options: DeepWebBookingOption[] = [];
  const seenUrl = new Set<string>();

  const push = (o: DeepWebBookingOption) => {
    const key = (o.url || o.title).toLowerCase();
    if (!o.title.trim()) return;
    if (seenUrl.has(key)) return;
    seenUrl.add(key);
    options.push(o);
  };

  if (result.formPrefill?.actionUrl) {
    push({
      title: (result.formPrefill.purpose || 'Buchung').slice(0, 80),
      summary: 'Belegter Buchungs-/Aktionslink',
      url: result.formPrefill.actionUrl,
      source: 'form',
    });
  }

  for (const f of result.facts ?? []) {
    const title = (f.place || f.label || '').trim().slice(0, 80);
    const summary = (f.value || '').trim().slice(0, 160);
    if (!title && !summary) continue;
    push({
      title: title || summary.slice(0, 48),
      summary: summary || title,
      url: f.sourceUrl ? String(f.sourceUrl) : null,
      source: 'fact',
    });
    if (options.length >= 5) break;
  }

  for (const s of result.sources ?? []) {
    if (!s?.url) continue;
    push({
      title: (s.title || s.url).slice(0, 80),
      summary: s.kind ? `Quelle (${s.kind})` : 'Web-Quelle',
      url: String(s.url),
      source: 'source',
    });
    if (options.length >= 5) break;
  }

  return options.slice(0, 5);
}

export async function researchDeepWebBooking(opts: {
  userText: string;
  cityHint?: string | null;
  wantBookingLink?: boolean;
  authorIntent?: string | null;
  mustKeys?: string[] | null;
  needTicket?: boolean;
  signal?: AbortSignal;
  budgetMs?: number;
  maxPasses?: number;
  searchFn?: DeepWebSearchFn;
}): Promise<DeepWebResearchResult> {
  const shaped = shapeDeepWebQuery(opts.userText, opts.cityHint, {
    authorIntent: opts.authorIntent,
    mustKeys: opts.mustKeys,
    needBookingLink: opts.wantBookingLink,
    needTicket: opts.needTicket,
    cityHint: opts.cityHint,
  });
  const budgetMs = Math.max(8_000, opts.budgetMs ?? deepWebTaskBudgetMs());
  const maxPasses = Math.max(1, Math.min(opts.maxPasses ?? 3, 4));
  const started = Date.now();

  const search: DeepWebSearchFn =
    opts.searchFn ??
    (async (query) => {
      const { runWebResearch } = require('../../services/research/webResearchService') as {
        runWebResearch: (
          text: string,
          o?: { force?: boolean },
        ) => Promise<DeepWebSearchHit | null>;
      };
      return runWebResearch(query, { force: true });
    });

  let options: DeepWebBookingOption[] = [];
  let notes = '';
  const queries: string[] = [];
  let passes = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    if (opts.signal?.aborted) break;
    const remaining = budgetMs - (Date.now() - started);
    if (pass > 0 && remaining < 4_000) break;

    const namedTitle =
      pass === 1
        ? options.find((o) => !o.url)?.title ?? null
        : null;
    const q = refineDeepWebQuery(shaped, pass, {
      cityHint: opts.cityHint,
      mustKeys: opts.mustKeys,
      namedTitle,
      wantBookingLink: opts.wantBookingLink,
    });
    if (pass > 0 && queries.includes(q)) continue;
    queries.push(q);
    passes += 1;
    try {
      const result = await search(q);
      if (result) {
        options = mergeDeepWebOptions(options, optionsFromResearch(result));
        notes = result.researchNotes || result.speechHint || notes;
      }
    } catch {
      /* weiter zum nächsten Pass */
    }

    const urlCount = options.filter((o) => o.url).length;
    if (
      !deepWebNeedsAnotherPass({
        wantBookingLink: opts.wantBookingLink,
        optionCount: options.length,
        buttonCount: urlCount,
      })
    ) {
      break;
    }
  }

  const top = options.slice(0, 3);
  const buttons = top
    .filter((o): o is DeepWebBookingOption & { url: string } => Boolean(o.url))
    .slice(0, 3)
    .map((o, i) => ({
      id: `deep_web_book_${i}`,
      label: (i === 0 ? 'Ticket / Buchen' : o.title).slice(0, 20),
      url: o.url,
    }));

  let ok = top.length > 0;
  try {
    const { isDeepWebTooThin } = require('./missionFollowThrough') as {
      isDeepWebTooThin: (o: {
        ok: boolean;
        buttonCount: number;
        wantBookingLink?: boolean;
      }) => boolean;
    };
    if (
      isDeepWebTooThin({
        ok,
        buttonCount: buttons.length,
        wantBookingLink: opts.wantBookingLink,
      })
    ) {
      ok = false;
    }
  } catch {
    if (
      deepWebNeedsAnotherPass({
        wantBookingLink: opts.wantBookingLink,
        optionCount: top.length,
        buttonCount: buttons.length,
      })
    ) {
      ok = false;
    }
  }

  const spokenDraft = top.length
    ? [
        'FAKTEN Deep-Web (nicht wörtlich):',
        ...top.map(
          (o, i) =>
            `${i + 1}) ${o.title}${o.priceLabel ? ` — ${o.priceLabel}` : ''}${o.url ? ` Link: ${o.url}` : ''}`,
        ),
        notes ? `Notizen: ${notes.slice(0, 200)}` : null,
        'FLOW: günstigste/sinnvollste Option zuerst; Buchungs-Button wenn URL belegt; nichts erfinden.',
        ok
          ? 'Kontrolldistanz: Beleg/Link sitzt.'
          : `Kontrolldistanz: nach ${passes} Suchlauf/läufen noch dünn — NICHT fertig; Lücke ehrlich, nichts erfinden.`,
      ]
        .filter(Boolean)
        .join('\n')
    : [
        `FAKTEN Deep-Web: keine harten Treffer (nach ${passes} Suchlauf/läufen).`,
        opts.wantBookingLink
          ? 'Kontrolldistanz: Buchungs-Need — NICHT „fertig“ sagen. Lücke transparent.'
          : looksLikeIslandFlight(opts.userText)
            ? 'Hinweis: Insel oft Charter/Privat statt Linie — ehrlich sagen und Alternativen (Fähre) prüfen.'
            : 'Ehrlich: Live-Web leer — nichts erfinden.',
        'FLOW: keine Fake-Preise, keine Fake-Links.',
      ].join('\n');

  const bullets = top
    .map((o) => o.title.slice(0, 72))
    .filter(Boolean)
    .slice(0, 3);

  return {
    ok,
    query: queries[queries.length - 1] || shaped,
    options: top,
    spokenDraft,
    bullets,
    buttons,
    promptBlock: spokenDraft,
    passes,
    queries,
  };
}
