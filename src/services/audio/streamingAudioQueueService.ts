/**
 * StreamingAudioQueueService — Zero-Latency Producer/Consumer Pipeline.
 *
 * 1. Punctuation-Splitter → frühe Hook-Chunks
 * 2. Prefetch: während Chunk N spielt, rendert Cartesia N+1 / N+2
 * 3. Gapless: next Sound ist schon createAsync(shouldPlay:false);
 *    bei didJustFinish → sofort playAsync()
 * 4. Flush: AbortController + Buffer leeren + Playback stoppen
 */

import { Audio } from 'expo-av';
import type { VoiceId } from '../../types/userProfile';
import {
  CartesiaAbortError,
  deleteCartesiaTempAudio,
  synthesizeCartesiaSpeechWav,
  type CartesiaGenerationConfig,
} from '../cartesiaTtsService';
import {
  streamingChunksFromTextStream,
  splitTextToStreamingChunks,
} from './punctuationChunker';
import {
  createLiveSubtitleFeed,
  mergeSubtitleCarry,
} from '../../utils/subtitleWholeWords';
import { useFinnusStore } from '../../store/useFinnusStore';

/** Fertige Audio-Chunks im RAM (URI + optional preloaded Sound). */
export type PrefetchBufferItem = {
  text: string;
  uri: string;
  /** Vorgewärmtes Sound — gapless Start ohne createAsync-Latenz. */
  sound: Audio.Sound | null;
};

export type StreamingQueueOptions = {
  voiceId?: VoiceId;
  /** Festes generation_config für alle Chunks. */
  generationConfig?: CartesiaGenerationConfig;
  /** Pro Chunk (Display-Text + Index) — z. B. Intro-Emotionsbogen. */
  resolveGenerationConfig?: (
    text: string,
    index: number,
  ) => CartesiaGenerationConfig | undefined;
  /** Wie viele fertige Chunks voraus im Buffer (nicht inkl. aktuell spielend). */
  prefetchLookahead?: number;
  prepareAudioText?: (text: string) => string;
  prepareDisplayText?: (text: string) => string;
  /** Externer Generation-Check (AudioVoiceService playbackGeneration). */
  isGenerationActive?: () => boolean;
  /** Live-Untertitel (wachsende Wörter). */
  onSubtitle?: (text: string | null) => void;
  /** Carry über äußere Chunk-Schleifen. */
  priorSubtitle?: string | null;
  onSubtitleCarry?: (carry: string | null) => void;
  /** Pro Chunk einmal (Attention / Tracking) — zusätzlich zum Live-Feed. */
  onChunkText?: (text: string) => void;
  /** true wenn Sound wirklich spielt, false wenn Pause/Ende zwischen Chunks */
  onAudibleChange?: (audible: boolean) => void;
  /** Bindet aktuelles Sound an AudioVoiceService.sound für Nav-Pause etc. */
  bindActiveSound?: (sound: Audio.Sound | null) => void;
  /**
   * Fertige Phrasen/Sätze nicht nochmal in 72-Zeichen-Hooks zerlegen.
   * Verhindert Stille nach Chunk-Fail mitten in der Antwort (Modul 2).
   */
  skipPhraseResplit?: boolean;
};

const DEFAULT_LOOKAHEAD = 2;

type SessionState = {
  id: number;
  abort: AbortController;
  flushed: boolean;
  ready: PrefetchBufferItem[];
  wakeReady: (() => void) | null;
  wakeSlot: (() => void) | null;
  activeSound: Audio.Sound | null;
  temps: string[];
};

let sessionCounter = 0;
let activeSession: SessionState | null = null;

function notifyReady(s: SessionState): void {
  const w = s.wakeReady;
  s.wakeReady = null;
  w?.();
}

function notifySlot(s: SessionState): void {
  const w = s.wakeSlot;
  s.wakeSlot = null;
  w?.();
}

async function unloadSound(sound: Audio.Sound | null): Promise<void> {
  if (!sound) return;
  try {
    await sound.stopAsync();
  } catch {
    /* ignore */
  }
  try {
    await sound.unloadAsync();
  } catch {
    /* ignore */
  }
}

async function preloadSound(uri: string): Promise<Audio.Sound> {
  const { sound } = await Audio.Sound.createAsync(
    { uri },
    { shouldPlay: false, progressUpdateIntervalMillis: 50 },
  );
  return sound;
}

/**
 * Wartet auf Playback-Ende.
 * Android: didJustFinish ist unzuverlässig — deshalb zusätzlich Status pollen.
 * Optional: Live-Untertitel über Positions-Progress.
 */
function waitUntilFinished(
  sound: Audio.Sound,
  isActive: () => boolean,
  onProgress?: (progress01: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sawPlaying = false;
    const reportProgress = (pos: number, dur: number) => {
      if (!onProgress || dur <= 0) return;
      onProgress(Math.min(1, Math.max(0, pos / dur)));
    };
    const done = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      try {
        onProgress?.(1);
      } catch {
        /* ignore */
      }
      resolve();
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const startedAt = Date.now();
    let lastPos = -1;
    let stalledSince: number | null = null;

    const poll = setInterval(() => {
      if (!isActive()) {
        done();
        return;
      }
      void sound
        .getStatusAsync()
        .then((status) => {
          if (settled) return;
          if (!status.isLoaded) return;
          const dur = status.durationMillis ?? 0;
          const pos = status.positionMillis ?? 0;
          reportProgress(pos, dur);

          if (dur > 0 && pos >= Math.max(0, dur - 50)) {
            done();
            return;
          }

          if (status.isPlaying) {
            sawPlaying = true;
            // Nur bei wirklich stehender Position — 1.5s war zu aggressiv
            // (Buffer/Seek-Jitter → vorzeitiges done → Rest-Chunks weg)
            if (pos === lastPos && pos > 0) {
              if (stalledSince == null) stalledSince = Date.now();
              else if (Date.now() - stalledSince >= 4500) done();
            } else {
              lastPos = pos;
              stalledSince = null;
            }
            return;
          }

          if (status.didJustFinish) {
            done();
            return;
          }
          // Kurz pausiert ≠ fertig — erst nach Settle als Ende werten
          if (sawPlaying && !status.isPlaying) {
            if (dur > 0 && pos >= Math.max(0, dur - 80)) {
              done();
              return;
            }
            if (stalledSince == null) stalledSince = Date.now();
            else if (Date.now() - stalledSince >= 2000) done();
            return;
          }
          const capMs = (dur > 0 ? dur : 30_000) + 2500;
          if (Date.now() - startedAt >= capMs) done();
        })
        .catch(() => {
          /* ignore poll errors */
        });
    }, 70);

    sound.setOnPlaybackStatusUpdate((status) => {
      if (settled) return;
      if (!status.isLoaded) {
        if ('error' in status && status.error) {
          fail(status.error);
        }
        return;
      }
      if (status.isPlaying) sawPlaying = true;
      if (status.isLoaded) {
        const dur = status.durationMillis ?? 0;
        const pos = status.positionMillis ?? 0;
        reportProgress(pos, dur);
        if (status.didJustFinish) {
          done();
          return;
        }
        if (dur > 0 && pos >= Math.max(0, dur - 50)) done();
      }
    });
  });
}

export function isStreamingAudioQueueBusy(): boolean {
  return activeSession != null && !activeSession.flushed;
}

export function getStreamingPrefetchDepth(): number {
  return activeSession?.ready.length ?? 0;
}

/**
 * Hard flush: Playback stoppen, Prefetch-Buffer löschen, Cartesia-XHRs abbrechen.
 */
export async function flushStreamingAudioQueue(): Promise<void> {
  const s = activeSession;
  if (!s) return;
  s.flushed = true;
  try {
    s.abort.abort();
  } catch {
    /* ignore */
  }
  const items = s.ready.splice(0, s.ready.length);
  notifyReady(s);
  notifySlot(s);
  await unloadSound(s.activeSound);
  s.activeSound = null;
  for (const item of items) {
    await unloadSound(item.sound);
    void deleteCartesiaTempAudio(item.uri);
  }
  for (const uri of s.temps) {
    void deleteCartesiaTempAudio(uri);
  }
  s.temps = [];
  if (activeSession?.id === s.id) activeSession = null;
}

async function waitForSlot(
  s: SessionState,
  lookahead: number,
): Promise<void> {
  while (!s.flushed && s.ready.length >= lookahead) {
    await new Promise<void>((resolve) => {
      s.wakeSlot = resolve;
    });
  }
}

async function takeReady(
  s: SessionState & { producerDone?: boolean },
): Promise<PrefetchBufferItem | null> {
  while (!s.flushed) {
    if (s.ready.length > 0) {
      const item = s.ready.shift()!;
      notifySlot(s);
      return item;
    }
    if (s.producerDone) return null;
    await new Promise<void>((resolve) => {
      s.wakeReady = resolve;
    });
    if (s.flushed) return null;
    if (s.ready.length === 0 && s.producerDone) return null;
  }
  return null;
}

type SessionWithDone = SessionState & { producerDone?: boolean };

/**
 * Spielt einen Text-/Satz-Stream mit Prefetch + Gapless Playback.
 */
export async function playStreamingAudioQueue(
  source: AsyncIterable<string> | string[],
  options: StreamingQueueOptions = {},
): Promise<void> {
  // Neuer Job: alte Session flushen (Interrupt-Sicherheit)
  if (activeSession) {
    await flushStreamingAudioQueue();
  }

  const lookahead = Math.max(1, options.prefetchLookahead ?? DEFAULT_LOOKAHEAD);
  const session: SessionWithDone = {
    id: ++sessionCounter,
    abort: new AbortController(),
    flushed: false,
    ready: [],
    wakeReady: null,
    wakeSlot: null,
    activeSound: null,
    temps: [],
    producerDone: false,
  };
  activeSession = session;

  const isActive = () =>
    !session.flushed &&
    activeSession?.id === session.id &&
    (options.isGenerationActive?.() ?? true);

  const displayOf = options.prepareDisplayText ?? ((t: string) => t.trim());
  const audioOf = options.prepareAudioText ?? ((t: string) => t.trim());
  const setSub =
    options.onSubtitle ??
    ((t: string | null) => useFinnusStore.getState().setSubtitleText(t));

  const textSource: AsyncIterable<string> = Array.isArray(source)
    ? (async function* () {
        for (const c of source) yield c;
      })()
    : source;

  // Normalize incoming pieces through punctuation chunker (handles full sentences too)
  async function* phraseChunks(): AsyncGenerator<string, void, unknown> {
    const skipResplit = Boolean(options.skipPhraseResplit);
    if (Array.isArray(source)) {
      for (const raw of source) {
        const display = displayOf(raw);
        if (!display) continue;
        if (skipResplit) {
          if (!isActive()) return;
          yield display;
          continue;
        }
        for (const c of splitTextToStreamingChunks(display)) {
          if (!isActive()) return;
          yield c;
        }
      }
      return;
    }
    if (skipResplit) {
      for await (const piece of textSource) {
        const d = displayOf(piece);
        if (!d) continue;
        if (!isActive()) return;
        yield d;
      }
      return;
    }
    for await (const c of streamingChunksFromTextStream(
      (async function* () {
        for await (const piece of textSource) {
          const d = displayOf(piece);
          if (d) yield d;
        }
      })(),
    )) {
      if (!isActive()) return;
      yield c;
    }
  }

  const producer = (async () => {
    try {
      let chunkIndex = 0;
      for await (const display of phraseChunks()) {
        if (!isActive()) return;
        const audio = audioOf(display);
        if (!audio) {
          console.warn(
            '[stream-queue] empty audio text, skip chunk:',
            display.slice(0, 48),
          );
          continue;
        }

        await waitForSlot(session, lookahead);
        if (!isActive()) return;

        const generationConfig =
          options.resolveGenerationConfig?.(display, chunkIndex) ??
          options.generationConfig;
        const t0 = Date.now();
        let uri: string | null = null;
        for (let attempt = 0; attempt < 2 && !uri; attempt++) {
          try {
            uri = await synthesizeCartesiaSpeechWav(audio, {
              voiceId: options.voiceId,
              signal: session.abort.signal,
              generationConfig,
            });
          } catch (err) {
            if (err instanceof CartesiaAbortError || !isActive()) return;
            console.warn(
              `[stream-queue] Cartesia fail #${chunkIndex} attempt ${attempt + 1}:`,
              err,
            );
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 180));
              continue;
            }
            // Nicht die ganze Antwort killen — Rest-Chunks weiter versuchen
            uri = null;
          }
        }
        if (!uri) continue;
        if (!isActive()) {
          void deleteCartesiaTempAudio(uri);
          return;
        }

        session.temps.push(uri);
        let sound: Audio.Sound | null = null;
        try {
          sound = await preloadSound(uri);
        } catch (err) {
          console.warn('[stream-queue] preload failed, play from uri:', err);
        }

        session.ready.push({ text: display, uri, sound });
        notifyReady(session);

        if (__DEV__) {
          const emo = generationConfig?.emotion ?? '-';
          console.log(
            `[stream-queue] prefetch #${chunkIndex} ${Date.now() - t0}ms (${display.length}c) emo=${emo} buf=${session.ready.length} «${display.slice(0, 40)}»`,
          );
        }
        chunkIndex += 1;
      }
    } catch (err) {
      if (!(err instanceof CartesiaAbortError)) {
        console.warn('[stream-queue] producer error:', err);
      }
    } finally {
      session.producerDone = true;
      notifyReady(session);
      notifySlot(session);
    }
  })();

  let subtitleCarry: string | null = options.priorSubtitle ?? null;
  try {
    // Consumer: gapless handoff — next Sound is preloaded; on didJustFinish
    // we playAsync(next) BEFORE unloading current (same microtask chain).
    let current: PrefetchBufferItem | null = await takeReady(session);
    let alreadyPlaying = false;
    const setAudible = (v: boolean) => {
      try {
        options.onAudibleChange?.(v);
      } catch {
        /* ignore */
      }
    };

    while (current && isActive()) {
      try {
        options.onChunkText?.(current.text);
      } catch {
        /* ignore */
      }

      const carry = subtitleCarry;
      const feed = createLiveSubtitleFeed(current.text, (t) =>
        setSub(mergeSubtitleCarry(carry, t)),
      );
      feed.showInitial();

      let playing = current.sound;
      if (!playing) {
        try {
          playing = await preloadSound(current.uri);
          current.sound = playing;
        } catch (err) {
          console.warn('[stream-queue] play create failed:', err);
          current = await takeReady(session);
          alreadyPlaying = false;
          continue;
        }
      }

      session.activeSound = playing;
      options.bindActiveSound?.(playing);

      const nextPromise = takeReady(session);

      if (!alreadyPlaying) {
        try {
          await playing.playAsync();
          setAudible(true);
        } catch (err) {
          console.warn('[stream-queue] playAsync failed:', err);
          setAudible(false);
        }
      } else {
        setAudible(true);
      }
      alreadyPlaying = false;

      await waitUntilFinished(playing, isActive, (p) => feed.updateProgress(p));
      feed.showFinal();
      subtitleCarry = mergeSubtitleCarry(subtitleCarry, current.text);

      setAudible(false);

      const next = isActive() ? await nextPromise : null;
      if (next) {
        let nextSound = next.sound;
        if (!nextSound) {
          try {
            nextSound = await preloadSound(next.uri);
            next.sound = nextSound;
          } catch (err) {
            console.warn('[stream-queue] next preload failed:', err);
            void unloadSound(playing);
            void deleteCartesiaTempAudio(current.uri);
            current = next;
            alreadyPlaying = false;
            continue;
          }
        }
        session.activeSound = nextSound;
        options.bindActiveSound?.(nextSound);
        try {
          await nextSound.playAsync();
          alreadyPlaying = true;
          setAudible(true);
        } catch (err) {
          console.warn('[stream-queue] gapless handoff play failed:', err);
          alreadyPlaying = false;
          setAudible(false);
        }
        void unloadSound(playing);
        void deleteCartesiaTempAudio(current.uri);
        current = next;
      } else {
        await unloadSound(playing);
        if (session.activeSound === playing) {
          session.activeSound = null;
          options.bindActiveSound?.(null);
        }
        void deleteCartesiaTempAudio(current.uri);
        current = null;
      }
    }
  } finally {
    options.onAudibleChange?.(false);
    try {
      options.onSubtitleCarry?.(subtitleCarry);
    } catch {
      /* ignore */
    }
    await producer.catch(() => undefined);
    if (activeSession?.id === session.id) {
      await unloadSound(session.activeSound);
      session.activeSound = null;
      options.bindActiveSound?.(null);
      for (const item of session.ready) {
        await unloadSound(item.sound);
        void deleteCartesiaTempAudio(item.uri);
      }
      session.ready = [];
      activeSession = null;
    }
  }
}

/**
 * Convenience: Volltext → Streaming-Queue.
 */
export async function playStreamingText(
  text: string,
  options?: StreamingQueueOptions,
): Promise<void> {
  const chunks = splitTextToStreamingChunks(text);
  if (chunks.length === 0) return;
  await playStreamingAudioQueue(chunks, options);
}
