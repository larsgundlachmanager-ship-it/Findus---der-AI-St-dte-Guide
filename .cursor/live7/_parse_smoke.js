function wordNumber(raw) {
  const map = {
    eine: 1, ein: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5,
    zehn: 10, zwanzig: 20, dreißig: 30, dreissig: 30,
  };
  return map[raw] ?? null;
}
const TIMER_INTENT = /\b(timer|eieruhr|countdown)\b/iu;
function parseTimerDurationMs(text) {
  const t = String(text || '')
    .normalize('NFKC')
    .replace(/[\u00A0\u202F\u2007\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const digMin = t.match(/(\d{1,3})\s*(?:minuten?|mins?|min\.?)\b/);
  if (digMin) {
    const n = Number(digMin[1]);
    if (n >= 1 && n <= 720) return n * 60000;
  }
  const wordMin = t.match(
    /\b(eine?|zwei|drei|vier|fünf|fuenf|zehn|fünfzehn|fuenfzehn|zwanzig|dreißig|dreissig)\s*(?:minuten?|mins?|min\.?)\b/,
  );
  if (wordMin) {
    const n = wordNumber(wordMin[1]);
    if (n != null && n >= 1 && n <= 720) return n * 60000;
  }
  if (TIMER_INTENT.test(t) || /\btimer\b/.test(t)) {
    const bare = t.match(/\b(?:in|auf|für|fuer)\s+(\d{1,3})\b/);
    if (bare) {
      const n = Number(bare[1]);
      if (n >= 1 && n <= 180) return n * 60000;
    }
    const anyNum = t.match(/(\d{1,3})/);
    if (anyNum) {
      const n = Number(anyNum[1]);
      if (n >= 1 && n <= 180) return n * 60000;
    }
  }
  return null;
}
for (const s of [
  'Timer 2 Minuten',
  'timer 2 minuten',
  'Timer',
  'stell einen Timer für 2 Minuten',
  'kannst du bitte einen Timer stellen für 2 Minuten',
]) {
  console.log(JSON.stringify(s), parseTimerDurationMs(s));
}
