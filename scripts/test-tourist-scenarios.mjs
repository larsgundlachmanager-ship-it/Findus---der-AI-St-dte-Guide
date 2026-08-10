/**
 * ~20 typische Touristen-Szenarien — Deterministik + Live-Gemini Intent-Router.
 * Run: node scripts/test-tourist-scenarios.mjs
 */
import 'dotenv/config';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
const MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-flash-lite-latest';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ─── Mirror of flightAdvisor guards (must stay in sync) ─────────────────────
function stripClockPhrases(text) {
  return text
    .replace(/\bum\s+\d{1,2}([:.\s]\d{2})?\s*(uhr)?\b/giu, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}\s*(uhr)?\b/giu, ' ')
    .replace(/\b\d{1,2}\s*uhr\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFlightCode(text, opts = {}) {
  const requireContext = opts.requireContext !== false;
  const FLIGHT_CONTEXT =
    /\b(flug|flieger|fliegen|flieg(?:e|st)?|abflug|boarding|gate|gepäckband|gepaeckband|baggage|flugnummer|flugstatus|flughafen|airline)\b/iu;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (requireContext && !FLIGHT_CONTEXT.test(trimmed)) {
    if (!/^[A-Za-z]{1,3}\s?\d{1,4}[A-Za-z]?$/i.test(trimmed)) return null;
  }
  const cleaned = stripClockPhrases(trimmed);
  if (!cleaned) return null;
  const upper = cleaned.toUpperCase();
  const known = upper.match(
    /\b((?:LH|LX|OS|BA|AF|KL|EW|U2|FR|W6|SK|AY|IB|TP|AZ|SN|DE|XQ|PC)\s?\d{1,4}[A-Z]?)\b/,
  );
  if (known?.[1]) return known[1].replace(/\s+/g, '');
  if (/\b(UM|AM|IM|PM|ZM|NM|BIS|AB)\s?\d{1,4}\b/.test(upper)) return null;
  const generic = upper.match(/\b([A-Z]{2,3}\s?\d{2,4}[A-Z]?)\b/);
  return generic?.[1] ? generic[1].replace(/\s+/g, '') : null;
}

function isHardFlightQuery(text) {
  return /\b(flugstatus|gate|boarding|gepäckband|gepaeckband|baggage|verspätung|verspaetung|flugnummer|wann\s+(?:muss|soll)\s+ich\s+(?:zum\s+)?flughafen)\b/iu.test(
    text,
  );
}

function wouldFlightHijack(text) {
  // Old broken behavior: isHardFlightQuery OR (flightQuery && code)
  // New: hard only with vocab; code never from clock
  return isHardFlightQuery(text) || !!extractFlightCode(text, { requireContext: true });
}

function discoveryWouldSteal(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (
    /\b(?:pünktlich|puenktlich|verabredung|termin|vorher|außerdem|ausserdem)\b/iu.test(t) ||
    /\b(?:um\s+)?\d{1,2}[:.]\d{2}\b/.test(t) ||
    (/\buhr\b/iu.test(t) && /\b(?:sein|muss|möchte|moechte)\b/iu.test(t)) ||
    (/\bhotel\b/iu.test(t) && /\b(?:brauch|einkauf|kaufen|spazier|herum)\b/iu.test(t))
  ) {
    return false;
  }
  if (/\b(restaurant|essen|mittag|abendessen|hunger)\b/iu.test(t)) {
    if (
      /\b(?:im|ins|zum|beim)\s+restaurant\s+\w+/iu.test(t) &&
      /\b(?:sein|verabredung|termin)\b/iu.test(t)
    ) {
      return false;
    }
    if (
      /\b(ich\s+(brauch|will|möchte|muss))\b.{0,40}\b(restaurant)\b/iu.test(t) ||
      /\b(gibt\s+es|wo\s+ist|wo\s+gibt|in\s+der\s+nähe|voraus|unterwegs)\b/iu.test(t)
    ) {
      return true;
    }
  }
  return false;
}

// ─── Scenarios ──────────────────────────────────────────────────────────────
/** @type {Array<{id:number, text:string, expect:object}>} */
const SCENARIOS = [
  {
    id: 1,
    text: 'Ich muss um 19:00 Uhr im Restaurant Kreta sein, brauche vorher eine Zahnbürste und eine Cola, sag Bescheid bei einem Supermarkt und bring mich rechtzeitig hin.',
    expect: {
      noFlightHijack: true,
      noDiscoverySteal: true,
      llmIntent: ['multi_stop', 'explore'],
      mustHave: { deadline: true, items: true, hotelOrFixed: true },
    },
  },
  {
    id: 2,
    text: 'Wo ist die nächste Toilette?',
    expect: { noFlightHijack: true, llmIntent: ['nav', 'explore', 'question', 'shopping'] },
  },
  {
    id: 3,
    text: 'Bring mich zum Hotel.',
    expect: { noFlightHijack: true, llmIntent: ['nav', 'multi_stop'] },
  },
  {
    id: 4,
    text: 'Wie spät hat der Dom heute auf?',
    expect: { noFlightHijack: true, llmIntent: ['question'] },
  },
  {
    id: 5,
    text: 'Ich habe Hunger, wo gibt es gutes Essen in der Nähe?',
    expect: { noFlightHijack: true, llmIntent: ['explore', 'nav', 'shopping', 'question'] },
  },
  {
    id: 6,
    text: 'Status von Flug LH400 bitte.',
    expect: {
      noFlightHijack: false, // hard flight vocab OK — but LLM should own it
      llmIntent: ['flight_status'],
      flightNumber: 'LH400',
    },
  },
  {
    id: 7,
    text: 'um 19 Uhr zum Abendessen',
    expect: { noFlightHijack: true, noDiscoverySteal: true, llmIntent: ['multi_stop', 'nav', 'explore', 'question'] },
  },
  {
    id: 8,
    text: 'Ich brauche noch eine Powerbank und Shampoo, melde dich wenn eine Drogerie kommt.',
    expect: { noFlightHijack: true, llmIntent: ['shopping', 'multi_stop', 'explore'] },
  },
  {
    id: 9,
    text: 'Erzähl mir was über diesen Brunnen da vorne.',
    expect: { noFlightHijack: true, llmIntent: ['question', 'explore'] },
  },
  {
    id: 10,
    text: 'Wie komme ich zum Bahnhof?',
    expect: { noFlightHijack: true, llmIntent: ['nav', 'question'] },
  },
  {
    id: 11,
    text: 'Stell mir einen Wecker für morgen um 7 Uhr.',
    expect: { noFlightHijack: true, llmIntent: ['clarify', 'question', 'nav'] },
  },
  {
    id: 12,
    text: 'Gibt es einen Bus zum Flughafen?',
    expect: { noFlightHijack: true, llmIntent: ['question', 'nav', 'explore'] },
  },
  {
    id: 13,
    text: 'Vorher noch zum Hotel, dann um 18:30 zum Restaurant Kreta, zwischendurch Bier und Zahnbürste kaufen, ich will noch rumlaufen.',
    expect: {
      noFlightHijack: true,
      noDiscoverySteal: true,
      llmIntent: ['multi_stop'],
      mustHave: { deadline: true, items: true },
    },
  },
  {
    id: 14,
    text: 'Ist das Museum heute geöffnet und was kostet der Eintritt?',
    expect: { noFlightHijack: true, llmIntent: ['question'] },
  },
  {
    id: 15,
    text: 'Zeig mir den Weg zur Apotheke.',
    expect: { noFlightHijack: true, llmIntent: ['nav', 'shopping', 'explore'] },
  },
  {
    id: 16,
    text: 'Ja bitte.',
    expect: { noFlightHijack: true, llmIntent: ['clarify', 'question', 'multi_stop', 'explore', 'nav', 'shopping'] },
  },
  {
    id: 17,
    text: 'Mein Flug ist LH1234, wann muss ich zum Flughafen?',
    expect: {
      noFlightHijack: false,
      llmIntent: ['flight_status'],
      flightNumberIncludes: 'LH',
      // deterministic: hard flight vocab present, code extractable with context
      mustExtractFlightWithContext: 'LH1234',
    },
  },
  {
    id: 18,
    text: 'Ich bin Vegetarier, merke dir das.',
    expect: { noFlightHijack: true, llmIntent: ['question', 'clarify'] },
  },
  {
    id: 19,
    text: 'Wo kann ich bar bezahlen und WLAN bekommen?',
    expect: { noFlightHijack: true, llmIntent: ['question', 'explore'] },
  },
  {
    id: 20,
    text: 'Route löschen / Navigation aus.',
    expect: { noFlightHijack: true, llmIntent: ['question', 'clarify', 'nav'] },
  },
];

function buildPrompt(userText) {
  const nowIso = new Date().toISOString();
  return [
    'Du bist das Gehirn der Findus-App (Reisebegleiter).',
    `Jetzt (ISO): ${nowIso}.`,
    'Analysiere den User-Input. Extrahiere Ziele, Deadlines, Einkäufe.',
    'Antworte NUR mit JSON:',
    '{',
    '  "intent": "multi_stop"|"explore"|"question"|"nav"|"shopping"|"clarify"|"flight_status",',
    '  "destinations": [{"name":string,"deadline":"HH:MM"|null,"kind":"fixed"|"hotel"|"dynamic"}],',
    '  "searchCategories": string[],',
    '  "items": string[],',
    '  "freeRoam": boolean,',
    '  "bufferMinutes": number,',
    '  "confirmSpeech": string,',
    '  "clarifySpeech": string|null,',
    '  "missingInfo": string|null,',
    '  "visualBullets": string[],',
    '  "quickActions": [{"type":"START_NAVIGATION"|"SHOW_MORE","label":string,"payload":object}],',
    '  "cardTitle": string|null,',
    '  "flightNumber": string|null',
    '}',
    'Regeln: um 19:00 = Deadline, NIEMALS flightNumber UM19.',
    'flight_status nur bei echtem Flug (LH400). multi_stop bei Termin+Einkauf+Hotel.',
    `User: „${userText.slice(0, 900)}“`,
  ].join('\n');
}

async function callGemini(userText) {
  const url = `${BASE}/models/${MODEL}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(userText) }] }],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ||
    '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no json');
  return JSON.parse(text.slice(start, end + 1));
}

function scoreScenario(sc, plan, geminiOk) {
  const checks = [];
  const add = (ok, label) => checks.push({ ok, label });

  if (sc.expect.noFlightHijack === true) {
    add(!wouldFlightHijack(sc.text), 'no flight regex hijack');
    add(extractFlightCode(sc.text) == null, 'extractFlightCode=null');
  }
  if (sc.expect.noFlightHijack === false) {
    // flight vocab scenarios — code may extract with context
    add(true, 'flight scenario (regex gate N/A)');
  }
  if (sc.expect.noDiscoverySteal === true) {
    add(!discoveryWouldSteal(sc.text), 'discovery does not steal');
  }

  if (sc.expect.mustExtractFlightWithContext) {
    const code = extractFlightCode(sc.text, { requireContext: true });
    add(
      code === sc.expect.mustExtractFlightWithContext,
      `extract with context=${code}`,
    );
  }

  if (geminiOk && plan) {
    if (sc.expect.llmIntent) {
      add(
        sc.expect.llmIntent.includes(plan.intent),
        `intent=${plan.intent} in [${sc.expect.llmIntent.join('|')}]`,
      );
    }
    if (sc.expect.flightNumber) {
      add(
        String(plan.flightNumber || '').toUpperCase() === sc.expect.flightNumber,
        `flightNumber=${plan.flightNumber}`,
      );
    }
    if (sc.expect.flightNumberIncludes) {
      add(
        String(plan.flightNumber || '')
          .toUpperCase()
          .includes(sc.expect.flightNumberIncludes),
        `flightNumber includes ${sc.expect.flightNumberIncludes}`,
      );
    }
    if (sc.expect.mustHave?.deadline) {
      const hasDl = (plan.destinations || []).some((d) => d.deadline);
      add(hasDl, 'has deadline');
    }
    if (sc.expect.mustHave?.items) {
      add(Array.isArray(plan.items) && plan.items.length >= 1, `items=${plan.items?.length ?? 0}`);
    }
    if (sc.expect.mustHave?.hotelOrFixed) {
      const ok = (plan.destinations || []).some(
        (d) => d.kind === 'fixed' || d.kind === 'hotel',
      );
      add(ok, 'has fixed/hotel stop');
    }
    // Critical anti-regression
    if (/um\s+\d{1,2}/i.test(sc.text) || /\d{1,2}[:.]\d{2}/.test(sc.text)) {
      add(
        !/^(UM|AM|IM)\d+$/i.test(String(plan.flightNumber || '')),
        'flightNumber not clock-fake',
      );
    }
    add(
      typeof plan.confirmSpeech === 'string' && plan.confirmSpeech.length >= 8,
      'confirmSpeech present',
    );
  }

  return checks;
}

async function main() {
  console.log('=== Findus Tourist Scenario Battery (20) ===\n');

  let geminiOk = false;
  if (API_KEY.length > 10) {
    try {
      await callGemini('Kurztest: antworte intent question.');
      geminiOk = true;
      console.log(`Gemini OK (${MODEL})\n`);
    } catch (e) {
      console.log(`Gemini UNAVAILABLE (${e.status || e.message}) — deterministic checks only\n`);
    }
  } else {
    console.log('No API key — deterministic checks only\n');
  }

  let pass = 0;
  let fail = 0;
  const rows = [];

  for (const sc of SCENARIOS) {
    let plan = null;
    let geminiErr = null;
    if (geminiOk) {
      try {
        plan = await callGemini(sc.text);
        await new Promise((r) => setTimeout(r, 350)); // soft rate limit
      } catch (e) {
        geminiErr = e.status || e.message;
        if (e.status === 429) geminiOk = false;
      }
    }

    const checks = scoreScenario(sc, plan, !!plan && !geminiErr);
    const okAll = checks.length > 0 && checks.every((c) => c.ok);
    if (okAll) pass++;
    else fail++;

    const status = okAll ? 'PASS' : 'FAIL';
    console.log(`#${sc.id} [${status}] ${sc.text.slice(0, 70)}${sc.text.length > 70 ? '…' : ''}`);
    for (const c of checks) {
      console.log(`   ${c.ok ? '✅' : '❌'} ${c.label}`);
    }
    if (plan) {
      console.log(
        `   → intent=${plan.intent} flight=${plan.flightNumber ?? '—'} items=${(plan.items || []).slice(0, 3).join(',') || '—'} dl=${(plan.destinations || []).map((d) => d.deadline).filter(Boolean).join(',') || '—'}`,
      );
    } else if (geminiErr) {
      console.log(`   → gemini error: ${geminiErr}`);
    } else {
      console.log('   → (no LLM — regex gates only)');
    }
    console.log('');
    rows.push({ id: sc.id, status, intent: plan?.intent, checks });
  }

  console.log('=== SUMMARY ===');
  console.log(`${pass}/${pass + fail} scenarios passed`);
  console.log(
    `Flight hijack guard on Kreta@19:00: ${!wouldFlightHijack(SCENARIOS[0].text) ? 'OK' : 'BROKEN'}`,
  );
  console.log(
    `Discovery steal on Kreta plan: ${!discoveryWouldSteal(SCENARIOS[0].text) ? 'OK' : 'BROKEN'}`,
  );

  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
