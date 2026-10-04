/**
 * Kreuzfahrt-FAQ: Was ist inklusive / extra (AIDA, Mein Schiff, generic).
 * Nur belegte Slots — keine Fake-Paketlisten. SSOT-Struktur: Owner-Gold.
 */

export type CruiseInclusionSlot = {
  topic: string;
  status: 'included' | 'extra' | 'package' | 'unclear';
  detail: string;
};

export type CruiseInclusionsEvidence = {
  lineName: string | null;
  included: CruiseInclusionSlot[];
  extras: CruiseInclusionSlot[];
  packages: CruiseInclusionSlot[];
  gaps: string[];
  sourceUrls: string[];
  evidenceNotes: string[];
};

export type CruiseInclusionsAnswer = {
  speech: string;
  bullets: string[];
  buttons: Array<{ id: string; label: string; url: string }>;
};

const CRUISE_LINE_RE =
  /\b(?:kreuzfahrt|mein(?:en|em|e)?\s+schiff|aida|adidia|aidia|aiida)\b/iu;

const INCLUSION_ASK_RE =
  /\b(?:inklusi[vw]|inklusive|dabei|was\s+(?:ist|gehört|gehoert)\s+(?:alles\s+)?(?:dabei|drin|inklusive)|was\s+kostet\s+extra|nicht\s+(?:dabei|inklusive)|trinkgeld|servicegebühr|servicegebuehr|bordguthaben|getränkepaket|getraenkepaket|getränke|getraenke|vollpension|premium[\s-]?all|all[\s-]?inclusive|wlan|wifi|spa(?:\s+inkl)?|landausflug)\b/iu;

export function looksLikeCruiseInclusionAsk(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (!CRUISE_LINE_RE.test(t)) return false;
  return INCLUSION_ASK_RE.test(t);
}

function detectLine(blob: string): string | null {
  if (/\bmein\s+schiff\b/iu.test(blob)) return 'Mein Schiff';
  if (/\b(?:aida|adidia|aidia|aiida)\b/iu.test(blob)) return 'AIDA';
  if (/\bkreuzfahrt\b/iu.test(blob)) return 'Kreuzfahrt';
  return null;
}

function pushSlot(
  list: CruiseInclusionSlot[],
  topic: string,
  status: CruiseInclusionSlot['status'],
  detail: string,
): void {
  if (list.some((s) => s.topic === topic && s.status === status)) return;
  list.push({ topic, status, detail: detail.slice(0, 120) });
}

/** Belegte Inklusiv-/Extra-Slots aus Research-Blob. */
export function extractCruiseInclusionsFromBlob(
  blob: string,
  opts?: { userText?: string | null },
): CruiseInclusionsEvidence {
  const t = String(blob || '').replace(/\s+/g, ' ').trim();
  const user = String(opts?.userText || '');
  const lineName = detectLine(`${user} ${t}`);
  const included: CruiseInclusionSlot[] = [];
  const extras: CruiseInclusionSlot[] = [];
  const packages: CruiseInclusionSlot[] = [];
  const gaps: string[] = [];
  const evidenceNotes: string[] = [];

  const markIncluded = (topic: string, detail: string) => {
    pushSlot(included, topic, 'included', detail);
    evidenceNotes.push(`${topic} inkl. (belegt)`);
  };
  const markExtra = (topic: string, detail: string) => {
    pushSlot(extras, topic, 'extra', detail);
    evidenceNotes.push(`${topic} extra (belegt)`);
  };
  const markPackage = (topic: string, detail: string) => {
    pushSlot(packages, topic, 'package', detail);
    evidenceNotes.push(`${topic} als Paket (belegt)`);
  };

  // Mahlzeiten
  if (/\bvollpension\b/iu.test(t) || /\b(?:frühstück|mittag|abendessen).{0,40}inklusi/iu.test(t)) {
    markIncluded('Mahlzeiten', 'Vollpension / Hauptrestaurants (belegt)');
  } else if (/\bspezialitätenrestaurant|specialty\s*restaurant|aufpreis.{0,24}restaurant\b/iu.test(t)) {
    markExtra('Spezialrestaurants', 'oft Aufpreis (belegt)');
  }

  // Getränke
  if (
    /\b(?:alkohol|spirituosen|wein|bier).{0,40}(?:inklusi|inklusive|enthalten)\b/iu.test(t) ||
    /\b(?:inklusi|inklusive|enthalten).{0,40}(?:alkohol|getränke|getraenke)\b/iu.test(t)
  ) {
    markIncluded('Getränke', 'inkl. Alkohol/Soft (belegt)');
  } else if (
    /\bgetränkepaket|getraenkepaket|drinks?\s*package|premium[\s-]?all[\s-]?inclusive\b/iu.test(t)
  ) {
    markPackage('Getränkepaket', 'optional buchbar (belegt)');
  } else if (
    /\b(?:alkohol|getränke|getraenke).{0,40}(?:nicht\s+inklusi|extra|aufpreis|gegen\s+gebühr)\b/iu.test(
      t,
    ) ||
    /\b(?:nicht\s+inklusi|extra|aufpreis).{0,40}(?:alkohol|getränke|getraenke)\b/iu.test(t)
  ) {
    markExtra('Getränke', 'nicht im Basispreis (belegt)');
  }

  // Soft drinks / Wasser
  if (/\b(?:wasser|softdrinks?|limo).{0,36}(?:inklusi|inklusive|enthalten)\b/iu.test(t)) {
    markIncluded('Soft-Drinks', 'belegt inklusive');
  }

  // Trinkgeld / Service
  if (
    /\btrinkgeld.{0,40}(?:inklusi|inklusive|enthalten|bereits)\b/iu.test(t) ||
    /\b(?:inklusi|inklusive).{0,40}trinkgeld\b/iu.test(t) ||
    /\bservicegebühr.{0,40}(?:inklusi|inklusive)\b/iu.test(t)
  ) {
    markIncluded('Trinkgeld/Service', 'Servicegebühr inkl. (belegt)');
  } else if (
    /\btrinkgeld.{0,40}(?:extra|zusätzlich|nicht\s+inklusi|freiwillig)\b/iu.test(t) ||
    /\b(?:extra|zusätzlich).{0,40}trinkgeld\b/iu.test(t)
  ) {
    markExtra('Trinkgeld/Service', 'nicht automatisch inkl. (belegt)');
  }

  // WLAN
  if (/\b(?:wlan|wifi|wi[\s-]?fi).{0,40}(?:inklusi|inklusive|kostenlos|gratis)\b/iu.test(t)) {
    markIncluded('WLAN', 'inkl. / gratis (belegt)');
  } else if (/\b(?:wlan|wifi).{0,40}(?:paket|aufpreis|gebühr|kostenpflicht)\b/iu.test(t)) {
    markPackage('WLAN', 'oft als Paket (belegt)');
  }

  // Spa
  if (/\b(?:spa|sauna|wellness).{0,40}(?:inklusi|inklusive|kostenlos)\b/iu.test(t)) {
    markIncluded('Spa', 'Teile belegt inklusive');
  } else if (/\b(?:spa|massage).{0,40}(?:aufpreis|extra|gebühr)\b/iu.test(t)) {
    markExtra('Spa/Massagen', 'Behandlungen oft extra (belegt)');
  }

  // Entertainment / Kids
  if (/\b(?:entertainment|shows?|theater|bordprogramm).{0,40}(?:inklusi|inklusive|enthalten)\b/iu.test(t)) {
    markIncluded('Entertainment', 'Shows/Bordprogramm (belegt)');
  }
  if (/\b(?:kinderbetreuung|kids?\s*club).{0,40}(?:inklusi|inklusive|kostenlos)\b/iu.test(t)) {
    markIncluded('Kids Club', 'belegt inklusive');
  }

  // Landausflüge
  if (/\b(?:landausflug|shore\s*excursion).{0,40}(?:extra|buchbar|aufpreis)\b/iu.test(t)) {
    markExtra('Landausflüge', 'meist extra buchbar (belegt)');
  }

  // Fitness
  if (/\b(?:fitness|sportstudio|gym).{0,40}(?:inklusi|inklusive|kostenlos)\b/iu.test(t)) {
    markIncluded('Fitness', 'belegt inklusive');
  }

  // Premium / All Inclusive product name
  if (/\bpremium[\s-]?all[\s-]?inclusive|genussvielfalt|aida\s+premium\b/iu.test(t)) {
    markPackage(
      'Premium-Tarif',
      lineName === 'AIDA'
        ? 'AIDA Premium / All Inclusive erwähnt (Details belegen)'
        : 'Premium-Inklusiv-Tarif erwähnt (Details belegen)',
    );
  }

  if (!included.length && !extras.length && !packages.length) {
    gaps.push('Inklusivliste für diese Frage noch nicht belegt');
  }

  // User fragte gezielt nach etwas ohne Treffer → Gap nennen
  if (/\btrinkgeld\b/iu.test(user) && !included.concat(extras).some((s) => /trinkgeld/i.test(s.topic))) {
    gaps.push('Trinkgeld-Regelung: Reederei-Seite prüfen');
  }
  if (
    /\b(?:getränk|getraenk|alkohol)\b/iu.test(user) &&
    !included.concat(extras, packages).some((s) => /getränk|drink|alkohol|soft/i.test(s.topic))
  ) {
    gaps.push('Getränke: Tarif/Paket noch belegen');
  }
  if (
    /\bwlan|wifi\b/iu.test(user) &&
    !included.concat(extras, packages).some((s) => /wlan/i.test(s.topic))
  ) {
    gaps.push('WLAN: aktuelles Paket prüfen');
  }

  return {
    lineName,
    included,
    extras,
    packages,
    gaps: gaps.slice(0, 3),
    sourceUrls: [],
    evidenceNotes: evidenceNotes.slice(0, 6),
  };
}

function weaveSpeech(ev: CruiseInclusionsEvidence): string {
  const line = ev.lineName || 'Kreuzfahrt';
  const bits: string[] = [];
  if (ev.included.length) {
    bits.push(
      `dabei ist laut Beleg ${ev.included
        .slice(0, 3)
        .map((s) => s.topic)
        .join(', ')}`,
    );
  }
  if (ev.extras.length) {
    bits.push(
      `extra zahlst du meist ${ev.extras
        .slice(0, 2)
        .map((s) => s.topic)
        .join(' und ')}`,
    );
  }
  if (ev.packages.length) {
    bits.push(
      `optional gibt’s ${ev.packages
        .slice(0, 2)
        .map((s) => s.topic)
        .join(' und ')}`,
    );
  }
  if (!bits.length) {
    return `Bei ${line} hängt „was inklusive ist“ stark vom Tarif ab — ich hab gerade keinen harten Beleg für deine Frage; schau kurz auf die Reederei-Seite oder sag mir den Tarifnamen.`;
  }
  const gap =
    ev.gaps.length && bits.length < 2
      ? ` ${ev.gaps[0]}`
      : '';
  return `Bei ${line} ${bits.join(' — ')}.${gap}`.replace(/\s+/g, ' ').trim().slice(0, 520);
}

function bulletsFrom(ev: CruiseInclusionsEvidence): string[] {
  const out: string[] = [];
  for (const s of ev.included.slice(0, 2)) {
    out.push(`Inkl.: ${s.topic}`);
  }
  for (const s of ev.extras.slice(0, 2)) {
    out.push(`Extra: ${s.topic}`);
  }
  for (const s of ev.packages.slice(0, 1)) {
    out.push(`Paket: ${s.topic}`);
  }
  for (const g of ev.gaps.slice(0, 1)) {
    if (out.length < 3) out.push(g.slice(0, 48));
  }
  return out.slice(0, 3);
}

/** Live-Web: Inklusivleistungen der genannten Reederei belegen. */
export async function researchCruiseInclusions(opts: {
  userText: string;
}): Promise<CruiseInclusionsEvidence> {
  const empty = extractCruiseInclusionsFromBlob('', { userText: opts.userText });
  const isMeinSchiff = /\bmein(?:en|em|e)?\s+schiff\b/iu.test(opts.userText);
  const isAida = /\b(?:aida|adidia|aidia|aiida)\b/iu.test(opts.userText);
  const lineLabel = isMeinSchiff ? 'Mein Schiff' : isAida ? 'AIDA' : 'Kreuzfahrt';
  const site = isMeinSchiff
    ? 'meinschiff.com Inklusivleistungen'
    : isAida
      ? 'aida.de Inklusivleistungen Premium All Inclusive'
      : 'Reederei Inklusivleistungen Trinkgeld Getränke';
  try {
    const { runWebResearch } = await import('../../services/research/webResearchService');
    const q = [
      lineLabel,
      'was ist inklusive Trinkgeld Getränke WLAN Spa Vollpension Landausflüge',
      opts.userText.slice(0, 120),
      site,
      'official',
    ]
      .filter(Boolean)
      .join(' ');
    const web = await runWebResearch(q, { force: true });
    const blob = [
      lineLabel,
      web?.speechHint,
      ...(web?.facts ?? []).map((f) => `${f.label} ${f.value}`),
      ...(web?.sources ?? []).map((s) => `${s.title || ''} ${s.url || ''}`),
    ]
      .filter(Boolean)
      .join(' · ');
    const parsed = extractCruiseInclusionsFromBlob(blob, { userText: opts.userText });
    if (!parsed.lineName) parsed.lineName = lineLabel === 'Kreuzfahrt' ? null : lineLabel;
    const urls = (web?.sources ?? [])
      .map((s) => s.url)
      .filter((u): u is string => Boolean(u))
      .filter((u) =>
        /mein\s*schiff|aida\.de|aida\.cruises|tui|kreuzfahrt|cruise|inklusiv|premium|check[\s-]?in/i.test(
          u,
        ),
      );
    parsed.sourceUrls = [
      ...new Set([
        ...urls,
        ...((web?.sources ?? []).map((s) => s.url).filter(Boolean) as string[]),
      ]),
    ].slice(0, 4);
    return parsed;
  } catch {
    return {
      ...empty,
      lineName: lineLabel === 'Kreuzfahrt' ? null : lineLabel,
      gaps: ['Inklusiv-Recherche gerade nicht erreichbar'],
    };
  }
}

export async function buildCruiseInclusionsAnswer(
  userText: string,
): Promise<CruiseInclusionsAnswer | null> {
  if (!looksLikeCruiseInclusionAsk(userText)) return null;
  const ev = await researchCruiseInclusions({ userText });
  const buttons: CruiseInclusionsAnswer['buttons'] = [];
  for (const url of ev.sourceUrls.slice(0, 2)) {
    const label = /aida/i.test(url)
      ? 'AIDA Infos'
      : /mein.?schiff/i.test(url)
        ? 'Mein Schiff Infos'
        : 'Reederei-Quelle';
    buttons.push({ id: `cruise_incl_${buttons.length}`, label: label.slice(0, 36), url });
  }
  // Soft partner fallbacks if research had no URL
  if (!buttons.length) {
    try {
      const { parseBriefSlots } = require('../../reisebuero/parseBriefSlots') as {
        parseBriefSlots: (t: string) => Record<string, unknown>;
      };
      const { cloneEmptyLedger, mergeLedger } = require('../../reisebuero/slotLedger') as {
        cloneEmptyLedger: () => Record<string, unknown>;
        mergeLedger: (a: Record<string, unknown>, b: Record<string, unknown>) => Record<string, unknown>;
      };
      const { cruisePartnerSearchLinks } = require('../../reisebuero/research/cruiseSearch') as {
        cruisePartnerSearchLinks: (l: Record<string, unknown>) => Array<{
          id: string;
          label: string;
          url: string;
        }>;
      };
      const ledger = mergeLedger(cloneEmptyLedger(), parseBriefSlots(userText));
      if (!ledger.tripShape) {
        (ledger as { tripShape?: unknown }).tripShape = {
          value: 'cruise',
          source: 'inferred',
          hardness: 'wish',
        };
      }
      for (const l of cruisePartnerSearchLinks(ledger as never).slice(0, 2)) {
        buttons.push({ id: l.id, label: l.label.slice(0, 36), url: l.url });
      }
    } catch {
      /* soft */
    }
  }
  return {
    speech: weaveSpeech(ev),
    bullets: bulletsFrom(ev),
    buttons: buttons.slice(0, 3),
  };
}
