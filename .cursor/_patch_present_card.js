const fs = require('fs');
const p = 'src/services/concierge/presentConcierge.ts';
let s = fs.readFileSync(p, 'utf8');

const a = `    await waitUntilVoicePlaying(1_200);
    // Pitch-Auswahl ODER Stichpunkte — nie beides; nach Pitch-✕ nicht wiederbeleben`;
const b = `    // Fused: Enqueue oft ohne sofortiges Audio — Stichpunkte sofort zeigen.
    if (!fusedTurnLive) {
      await waitUntilVoicePlaying(1_200);
    }
    // Pitch-Auswahl ODER Stichpunkte — nie beides; nach Pitch-✕ nicht wiederbeleben`;
if (s.includes(a)) {
  s = s.replace(a, b);
  console.log('card wait patched');
} else {
  console.log('card wait NOT found');
}

const c = `          if (
            tries < 200 &&
            (isStreamingAudioQueueBusy() || getActiveTtsSessionCount() > 0)
          ) {
            setTimeout(tick, 150);
            return;
          }`;
const d = `          // Max ~6s — klebende Streaming-Session darf Mic nicht dauerblau halten.
          if (
            tries < 40 &&
            (isStreamingAudioQueueBusy() || getActiveTtsSessionCount() > 0)
          ) {
            setTimeout(tick, 150);
            return;
          }`;
if (s.includes(c)) {
  s = s.replace(c, d);
  console.log('settle cap patched');
} else if (s.includes('tries < 40 &&')) {
  console.log('settle already capped');
} else {
  console.log('settle NOT found');
  const i = s.indexOf('tries <');
  console.log(s.slice(i, i + 180));
}

const tmp = p + '.tmp';
fs.writeFileSync(tmp, s);
fs.renameSync(tmp, p);
console.log('presentConcierge written');
