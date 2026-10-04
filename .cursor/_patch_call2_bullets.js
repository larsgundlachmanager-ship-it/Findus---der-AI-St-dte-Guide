const fs = require('fs');

function patch(path, replacer) {
  let s = fs.readFileSync(path, 'utf8');
  const next = replacer(s);
  if (next === s) {
    console.log('no change', path);
    return;
  }
  const tmp = path + '.tmp';
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, path);
  console.log('patched', path);
}

patch('src/module2/speech/speechQueue.ts', (s) => {
  s = s.replace(
    /export function isSpeechActive\(\): boolean \{\n  return playing \|\| mainActiveOrPending \|\| queue\.length > 0;\n\}/,
    `export function isSpeechActive(): boolean {
  if (playing || queue.length > 0) return true;
  if (!mainActiveOrPending) return false;
  // Fused-Pfad setzt mainActiveOrPending, spielt aber nicht über diese Queue —
  // Flag darf nicht ewig kleben (sonst Call-2/Idle tot, Mic dauerblau).
  try {
    const {
      isStreamingAudioQueueBusy,
    } = require('../../services/audio/streamingAudioQueueService');
    if (isStreamingAudioQueueBusy()) return true;
  } catch {}
  try {
    const { getActiveTtsSessionCount } = require('../../services/AudioVoiceService');
    if (getActiveTtsSessionCount() > 0) return true;
  } catch {}
  mainActiveOrPending = false;
  return false;
}`,
  );
  s = s.replace(
    `      void fused.fusedEnqueue({
        kind: opts.kind,
        text,
        turnId: opts.turnId,
      });
      if (opts.kind === 'main') mainActiveOrPending = true;
      return id;`,
    `      void fused
        .fusedEnqueue({
          kind: opts.kind,
          text,
          turnId: opts.turnId,
        })
        .finally(() => {
          // Busy läuft über Streaming-TTS — Queue-Flag nicht kleben lassen.
          if (opts.kind === 'main') {
            mainActiveOrPending = queue.some((j) => j.kind === 'main');
          }
        });
      return id;`,
  );
  return s;
});

patch('src/services/concierge/bulletDigits.ts', (s) => {
  if (s.includes('replaceBareNumberWords')) {
    console.log('bulletDigits already has bare words');
    return s;
  }
  s = s.replace(
    `function replaceSimpleCounts(s: string): string {
  return s.replace(
    /\\b([A-Za-zÄÖÜäöüß]{3,40})\\s+(Euro|€|Meter|m|Stufen|Minuten|Min)\\b/giu,
    (full, word: string, unit: string) => {
      const n = germanWordToNumber(word);
      if (n == null || n > 10000) return full;
      return \`\${n} \${unit}\`;
    },
  );
}`,
    `function replaceSimpleCounts(s: string): string {
  return s.replace(
    /\\b([A-Za-zÄÖÜäöüß]{3,40})\\s+(Euro|€|Meter|m|Stufen|Minuten|Min|Grad|°C?)\\b/giu,
    (full, word: string, unit: string) => {
      const n = germanWordToNumber(word);
      if (n == null || n > 10000) return full;
      if (/^grad$/iu.test(unit) || unit.startsWith('°')) return \`\${n}°\`;
      return \`\${n} \${unit}\`;
    },
  );
}

/** Einzelne Zahlwörter → Ziffern (Stichpunkte, nicht Speech). */
function replaceBareNumberWords(s: string): string {
  return s.replace(
    /\\b([A-Za-zÄÖÜäöüß]{3,40})\\b/giu,
    (word) => {
      const n = germanWordToNumber(word);
      if (n == null || n > 100) return word;
      const foldW = fold(word).replace(/[^a-z]/g, '');
      if (
        foldW === 'ein' ||
        foldW === 'eine' ||
        foldW === 'einem' ||
        foldW === 'einen' ||
        foldW === 'eines' ||
        foldW === 'einer'
      ) {
        return word;
      }
      return String(n);
    },
  );
}`,
  );
  s = s.replace(
    `  s = replaceSimpleCounts(s);
  return s.replace(/\\s+/g, ' ').trim();
}`,
    `  s = replaceSimpleCounts(s);
  s = replaceBareNumberWords(s);
  return s.replace(/\\s+/g, ' ').trim();
}`,
  );
  return s;
});
