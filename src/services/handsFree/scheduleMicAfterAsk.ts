/**
 * Nach einer direkten Rückfrage Mikro wieder auf — ohne extra Tipp.
 * Nur wenn TTS ruhig ist. Immer Live-Chat-Endpointing (Silence/Cut),
 * nie Locked-Hands-Free ohne Auto-Ende.
 */

let scheduleGen = 0;

/** Chip/Quick-Reply: pending Reopen abbrechen. */
export function cancelScheduledMicAfterAsk(): void {
  scheduleGen += 1;
}

export function scheduleMicAfterDirectAsk(opts?: {
  ignoreGenerating?: boolean;
}): void {
  const myGen = ++scheduleGen;
  void (async () => {
    try {
      const {
        isLiveChatActive,
        startLiveChatSession,
        releaseLiveChatFloorForAsk,
      } = await import('./liveChatSession');
      // Laufender Live-Chat: Floor freigeben (processing-Block), sonst hängt Mic
      // „an“ ohne Cut/Absenden — genau die Flug-Rückfrage-Falle.
      if (isLiveChatActive()) {
        if (myGen !== scheduleGen) return;
        releaseLiveChatFloorForAsk();
        return;
      }
      const { isSpeechActive } = await import('../../module2/speech/speechQueue');
      const { isAudiblyPlaying } = await import('../AudioVoiceService');
      const { useFinnusStore } = await import('../../store/useFinnusStore');
      const deadline = Date.now() + 28_000;
      while (Date.now() < deadline) {
        if (myGen !== scheduleGen) return;
        const ui = useFinnusStore.getState();
        const generatingBusy = opts?.ignoreGenerating ? false : ui.isGenerating;
        if (
          !isSpeechActive() &&
          !isAudiblyPlaying() &&
          !ui.isPlayingAudio &&
          !ui.isAudiblySpeaking &&
          !generatingBusy
        ) {
          await new Promise((r) => setTimeout(r, 450));
          if (myGen !== scheduleGen) return;
          const again = useFinnusStore.getState();
          if (
            isSpeechActive() ||
            isAudiblyPlaying() ||
            again.isPlayingAudio ||
            again.isAudiblySpeaking
          ) {
            continue;
          }
          // Immer Live-Chat mit Endpointing — kein Fallback auf Locked-PTT.
          let started = await startLiveChatSession('direct_ask');
          if (!started.ok && myGen === scheduleGen) {
            await new Promise((r) => setTimeout(r, 350));
            if (myGen !== scheduleGen) return;
            started = await startLiveChatSession('direct_ask');
          }
          if (!started.ok && __DEV__) {
            console.warn(
              '[scheduleMicAfterAsk] live chat start failed:',
              started.message,
            );
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch {
      /* soft */
    }
  })();
}

/**
 * Quick-Reply / Action-Chip: Mic + ggf. pending Reopen sofort tot.
 * TTS-Stop bleibt Aufgabe von stopVoiceOnUserTap / abortAudioOnUserTap.
 */
export async function abortListenSessionForUiChoice(
  reason = 'ui_choice',
): Promise<void> {
  cancelScheduledMicAfterAsk();
  try {
    const {
      isLiveChatActive,
      stopLiveChatSession,
    } = await import('./liveChatSession');
    if (isLiveChatActive()) {
      await stopLiveChatSession(reason);
      return;
    }
  } catch {
    /* soft */
  }
  try {
    const { isCurrentlyListening, stopListening } = await import('../sttService');
    if (isCurrentlyListening()) {
      await stopListening({ tailMs: 0, finalizeMs: 0 });
    }
  } catch {
    /* soft */
  }
  try {
    const { requestAbortHandsFreeUi } = await import('./handsFreeBus');
    requestAbortHandsFreeUi(reason);
  } catch {
    /* soft */
  }
}
