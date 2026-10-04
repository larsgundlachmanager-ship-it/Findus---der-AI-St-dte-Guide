const fs = require('fs');

function patch(path, fn) {
  let s = fs.readFileSync(path, 'utf8');
  const next = fn(s);
  if (next === s) {
    console.log('no change', path);
    return false;
  }
  const tmp = path + '.tmp';
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, path);
  console.log('patched', path);
  return true;
}

// useVoiceInput: capped release instead of infinite isTurnSpeechOrResearchPending poll
patch('src/hooks/useVoiceInput.ts', (s) => {
  const old = `        } finally {
          if (stillCurrent(epoch)) {
            const release = () => {
              if (!stillCurrent(epoch)) return;
              try {
                const {
                  isTurnSpeechOrResearchPending,
                } = require('../utils/phinnosMood') as {
                  isTurnSpeechOrResearchPending: () => boolean;
                };
                if (isTurnSpeechOrResearchPending()) {
                  setTimeout(release, 150);
                  return;
                }
              } catch {
                /* soft */
              }
              setIsGenerating(false);
            };
            release();
          }
        }
      } finally {
        if (stillCurrent(epoch)) {
          const release = () => {
            if (!stillCurrent(epoch)) return;
            try {
              const {
                isTurnSpeechOrResearchPending,
              } = require('../utils/phinnosMood') as {
                isTurnSpeechOrResearchPending: () => boolean;
              };
              if (isTurnSpeechOrResearchPending()) {
                setTimeout(release, 150);
                return;
              }
            } catch {
              /* soft */
            }
            setIsGenerating(false);
          };
          release();
        }
        onUserInputEnd();
      }`;

  const neu = `        } finally {
          if (stillCurrent(epoch)) {
            // Cap: nie endlos blau (Streaming kann kleben).
            let tries = 0;
            const release = () => {
              if (!stillCurrent(epoch)) return;
              tries += 1;
              try {
                const {
                  isLiveSpeechTransportBusy,
                } = require('../utils/phinnosMood') as {
                  isLiveSpeechTransportBusy: () => boolean;
                };
                if (tries < 40 && isLiveSpeechTransportBusy()) {
                  setTimeout(release, 150);
                  return;
                }
              } catch {
                /* soft */
              }
              setIsGenerating(false);
            };
            release();
          }
        }
      } finally {
        if (stillCurrent(epoch)) {
          let tries = 0;
          const release = () => {
            if (!stillCurrent(epoch)) return;
            tries += 1;
            try {
              const {
                isLiveSpeechTransportBusy,
              } = require('../utils/phinnosMood') as {
                isLiveSpeechTransportBusy: () => boolean;
              };
              if (tries < 40 && isLiveSpeechTransportBusy()) {
                setTimeout(release, 150);
                return;
              }
            } catch {
              /* soft */
            }
            setIsGenerating(false);
          };
          release();
        }
        onUserInputEnd();
      }`;

  if (!s.includes('isTurnSpeechOrResearchPending')) {
    console.log('voice already without pending poll');
    return s;
  }
  if (!s.includes(old.slice(0, 80))) {
    // softer replace of both release blocks
    s = s.replace(
      /isTurnSpeechOrResearchPending/g,
      'isLiveSpeechTransportBusy',
    );
    s = s.replace(
      /if \(isLiveSpeechTransportBusy\(\)\) \{\s*setTimeout\(release, 150\);\s*return;\s*\}/g,
      `if (tries < 40 && isLiveSpeechTransportBusy()) {
                  setTimeout(release, 150);
                  return;
                }`,
    );
    // inject tries
    s = s.replace(
      /if \(stillCurrent\(epoch\)\) \{\s*const release = \(\) => \{/g,
      `if (stillCurrent(epoch)) {
            let tries = 0;
            const release = () => {
              tries += 1;`,
    );
    return s;
  }
  return s.replace(old, neu);
});

// presentConcierge settleUi: shorter cap + always clear generating
patch('src/services/concierge/presentConcierge.ts', (s) => {
  return s.replace(
    `          if (
            tries < 200 &&
            (isStreamingAudioQueueBusy() || getActiveTtsSessionCount() > 0)
          ) {
            setTimeout(tick, 150);
            return;
          }`,
    `          // Max ~6 s — klebende Streaming-Session darf Mic/Stichpunkte nicht blocken.
          if (
            tries < 40 &&
            (isStreamingAudioQueueBusy() || getActiveTtsSessionCount() > 0)
          ) {
            setTimeout(tick, 150);
            return;
          }`,
  );
});

// fusedTurnSpeech: shorter busy clear cap
patch('src/module2/speech/fusedTurnSpeech.ts', (s) => {
  return s.replace(
    'if (isTurnSpeechPendingIgnoringGateBusy() && tries < 200)',
    'if (isTurnSpeechPendingIgnoringGateBusy() && tries < 40)',
  );
});

// Show card even if voice not yet audible (fused gap) — already does after timeout.
// Also show card BEFORE wait when fused, so bullets appear during Call-1→Call-2.
patch('src/services/concierge/presentConcierge.ts', (s) => {
  const marker = `    await waitUntilVoicePlaying(1_200);
    // Pitch-Auswahl ODER Stichpunkte — nie beides; nach Pitch-✕ nicht wiederbeleben
    let pitchLive = false;`;
  if (!s.includes(marker)) {
    console.log('card wait marker missing');
    return s;
  }
  return s.replace(
    marker,
    `    // Fused: Call-2-Enqueue oft ohne sofortiges Audio — Stichpunkte nicht hinter
    // waitUntilVoicePlaying verstecken (sonst leerer Spickzettel + nur blauer Kreis).
    if (fusedTurnLive) {
      /* show ASAP below */
    } else {
      await waitUntilVoicePlaying(1_200);
    }
    // Pitch-Auswahl ODER Stichpunkte — nie beides; nach Pitch-✕ nicht wiederbeleben
    let pitchLive = false;`,
  );
});

console.log('done');
