/**
 * Live test: Gemini LLM Intent Router with multi-goal utterance.
 * Run: node scripts/test-llm-intent-router.mjs
 */
import 'dotenv/config';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
const MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-2.5-flash-lite';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const USER = `Ich möchte gerne um 18:30 Uhr im Restaurant Kreta sein, da habe ich eine Verabredung. Möchte aber jetzt ein bisschen herumspazieren und den Ort angucken. Brauche auf jeden Fall noch eine Zahnbürste, Wasser, eine Cola, vielleicht noch ein Wegbier. Bevor ich zum Restaurant gehe, möchte ich nochmal zum Hotel. Sag Bescheid wenn ein Supermarkt in der Nähe ist der die Sachen hat, und sorge dafür dass ich pünktlich um 18:30 im Restaurant bin.`;

function buildPrompt(userText) {
  const nowIso = new Date().toISOString();
  return [
    'Du bist das Gehirn der Findus-App (Reisebegleiter).',
    `Jetzt (ISO): ${nowIso}.`,
    'Ort-Kontext: Teststadt.',
    'Analysiere den User-Input UND den Chat-Kontext.',
    'Extrahiere ALLE Ziele, Deadlines, Zwischenstopps, Einkäufe, Free-Roam-Wünsche — nichts weglassen.',
    'Antworte NUR mit einem JSON-Objekt (kein Markdown):',
    '{',
    '  "intent": "multi_stop" | "explore" | "question" | "nav" | "shopping" | "clarify",',
    '  "destinations": [{ "name": string, "deadline": "HH:MM"|null, "kind": "fixed"|"hotel"|"dynamic" }],',
    '  "searchCategories": string[],',
    '  "items": string[],',
    '  "freeRoam": boolean,',
    '  "bufferMinutes": number,',
    '  "confirmSpeech": string,',
    '  "clarifySpeech": string|null,',
    '  "missingInfo": string|null,',
    '  "visualBullets": string[],',
    '  "quickActions": [{ "type": "START_NAVIGATION"|"SHOW_MORE", "label": string, "payload": { "destName"?: string, "textPrompt"?: string } }],',
    '  "cardTitle": string|null',
    '}',
    'Regeln:',
    '- multi_stop wenn mehrere Ziele/Bedürfnisse.',
    '- items: ALLE Produkte.',
    '- deadline HH:MM.',
    '- confirmSpeech: 2–4 Sätze Umgangssprache, bestätigt den GANZEN Plan.',
    '- visualBullets: 3–6 Stichpunkte in sinnvoller Reihenfolge.',
    '- quickActions: 2–4 Tip-Buttons.',
    '- Produktnamen sind NIEMALS Hotel-Namen.',
    'Chat-Kontext: (leer)',
    `Aktueller User-Input: „${userText}“`,
  ].join('\n');
}

function scorePlan(plan) {
  const checks = [];
  const pass = (ok, label) => {
    checks.push({ ok, label });
    return ok;
  };

  pass(plan.intent === 'multi_stop' || plan.intent === 'explore', `intent=${plan.intent}`);
  pass(plan.freeRoam === true, 'freeRoam');
  pass(
    Array.isArray(plan.destinations) &&
      plan.destinations.some((d) => d.kind === 'fixed' && /kreta/i.test(d.name)),
    'fixed destination Kreta',
  );
  pass(
    Array.isArray(plan.destinations) &&
      plan.destinations.some((d) => d.kind === 'fixed' && d.deadline && /18[:.]?30/.test(String(d.deadline))),
    'deadline 18:30',
  );
  pass(
    Array.isArray(plan.destinations) &&
      plan.destinations.some((d) => d.kind === 'hotel'),
    'hotel stop',
  );
  pass(
    Array.isArray(plan.destinations) &&
      plan.destinations.some((d) => d.kind === 'dynamic') ||
      (Array.isArray(plan.items) && plan.items.length >= 3),
    'dynamic shop or items',
  );
  const itemsJoined = (plan.items || []).join(' ').toLowerCase();
  pass(/zahnbürste|zahnbuerste|zahn/.test(itemsJoined), 'item Zahnbürste');
  pass(/cola/.test(itemsJoined), 'item Cola');
  pass(/bier|wegbier|wasser/.test(itemsJoined), 'item Bier/Wasser');
  pass(
    Array.isArray(plan.searchCategories) && plan.searchCategories.length >= 1,
    'searchCategories',
  );
  pass(
    typeof plan.confirmSpeech === 'string' && plan.confirmSpeech.length >= 40,
    'confirmSpeech length',
  );
  pass(
    Array.isArray(plan.visualBullets) && plan.visualBullets.length >= 3,
    `bullets=${plan.visualBullets?.length ?? 0}`,
  );
  pass(
    Array.isArray(plan.quickActions) && plan.quickActions.length >= 2,
    `actions=${plan.quickActions?.length ?? 0}`,
  );
  pass(!/zahnbürste|cola|bier/i.test(JSON.stringify(plan.destinations?.filter((d) => d.kind === 'hotel') || [])), 'hotel is not a product');

  const okCount = checks.filter((c) => c.ok).length;
  return { checks, okCount, total: checks.length, passRate: okCount / checks.length };
}

async function main() {
  if (!API_KEY || API_KEY.length < 10) {
    console.error('FAIL: no Gemini API key');
    process.exit(2);
  }

  const prompt = buildPrompt(USER);
  const url = `${BASE}/models/${MODEL}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1100,
      responseMimeType: 'application/json',
    },
  };

  console.log('Calling', MODEL, '…');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error('HTTP', res.status, JSON.stringify(json).slice(0, 500));
    process.exit(1);
  }

  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ||
    '';
  let plan;
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    plan = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    console.error('JSON parse fail:', text.slice(0, 800));
    process.exit(1);
  }

  console.log('\n=== GEMINI PLAN ===');
  console.log(JSON.stringify(plan, null, 2));

  const score = scorePlan(plan);
  console.log('\n=== SCORE ===');
  for (const c of score.checks) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.label}`);
  }
  console.log(`\n${score.okCount}/${score.total} (${Math.round(score.passRate * 100)}%)`);

  if (score.passRate < 0.85) {
    console.error('\nTEST FAILED — too many missing pieces');
    process.exit(1);
  }
  console.log('\nTEST PASSED — multi-intent understanding looks solid');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
