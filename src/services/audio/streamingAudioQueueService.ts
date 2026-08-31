/**
 * StreamingAudioQueueService — Zero-Latency Producer/Consumer Pipeline.
 * TTS_SENTENCE_PIPELINE_LOCK — nicht Satz-für-Satz-Jobs. Fast-Hook + Prefetch.
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
  estimateSpeechDurationMs,
  mergeSubtitleCarry,
} from '../../utils/subtitleWholeWords';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  peekWavDurationMs,
  resolveWavDurationMs,
} from '../../utils/wavDurationMs';

/** Fertige Audio-Chunks im RAM (URI + optional preloaded Sound). */
export type PrefetchBufferItem = {
  text: string;
  uri: string;
  /** Vorgewärmtes Sound — gapless Start ohne createAsync-Latenz. */
  sound: Audio.Sound | null;
  /** Eine createAsync-Session pro Clip — Producer und Consumer teilen sich das. */
  preload?: Promise<Audio.Sound | null>;
  /** Echte WAV-Dauer (ms) — Untertitel 1:1 zur Stimme. */
  durationMs?: number;
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
   * Fertige Phrasen/Sätze nicht nochmal in First-Hooks zerlegen.
   * Verhindert Stille nach Chunk-Fail mitten in der Antwort (Modul 2).
   */
  skipPhraseResplit?: boolean;
  /**
   * Play erst nach diesem Gate (Bridge fertig). Producer läuft schon:
   * Clips landen in der Warteschlange, erster Hook bleibt in der Hand.
   */
  holdPlayUntil?: () => Promise<void>;
  /**
   * Wachsender Prefetch: Start = prefetchLookahead (1 = Fast-Hook), wächst je
   * abgespieltem Chunk bis prefetchLookaheadMax (Default 6).
   */
  prefetchLookaheadMax?: number;
  /** true → nach aktuellem Chunk Nav-Cue einschieben, Rest bleibt in der Queue. */
  peekChunkGap?: () => boolean;
  /** Spielt den eingeschobenen Cue; true = Gap war da (kein gapless Handoff). */
  onChunkGap?: () => Promise<boolean>;
};

/** Start klein — erster Hook spielt sofort, Puffer wächst während des Sprechens. */
const DEFAULT_LOOKAHEAD = 1;
/** Fertige Clips in der Warteschlange (nicht inkl. aktuell spielend / next). */
const DEFAULT_LOOKAHEAD_MAX = 6;
/** Parallel Cartesia: während Satz 3 spielt → Satz 5 und 6 schon in Arbeit (4 liegt bereit). */
const MAX_SYNTH_INFLIGHT = 2;

type SessionState = {
  id: number;
  abort: AbortController;
  flushed: boolean;
  ready: PrefetchBufferItem[];
  wakeReady: (() => void) | null;
  wakeSlot: (() => void) | null;
  activeSound: Audio.Sound | null;
  temps: string[];
  /** Aktuelles Prefetch-Ziel (wächst mit abgespielten Chunks). */
  lookaheadTarget: number;
  lookaheadMax: number;
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

function ensurePreload(item: PrefetchBufferItem): Promise<Audio.Sound | null> {
  if (item.sound) return Promise.resolve(item.sound);
  if (!item.preload) {
    item.preload = preloadSound(item.uri)
      .then(async (sound) => {
        item.sound = sound;
        try {
          const st = await sound.getStatusAsync();
          if (st.isLoaded && (st.durationMillis ?? 0) > 0) {
            item.durationMs = st.durationMillis;
          }
        } catch {
          /* ignore */
        }
        if (!item.durationMs) {
          const ms = await resolveWavDurationMs(item.uri);
          if (ms > 0) item.durationMs = ms;
        }
        return sound;
      })
      .catch((err) => {
        console.warn('[stream-queue] preload failed, play from uri:', err);
        return null;
      });
  }
  return item.preload;
}

/**
 * Wartet auf Playback-Ende.
 * Android: didJustFinish ist unzuverlässig — deshalb zusätzlich Status pollen.
 * Optional: Live-Untertitel über Positions-Progress.
 */
function waitUntilFinished(
  sound: Audio.Sound,
  isActive: () => boolean,
  onProgress?: (progress01: number, durationMs?: number) => void,
  /** true → letzter ~80ms dürfen in den nächsten Clip übergehen (sonst bis didJustFinish). */
  handoffReady?: () => boolean,
  /** Wenn durationMillis 0 bleibt (Android): Wort-Fortschritt über geschätzte Länge. */
  fallbackDurMs?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sawPlaying = false;
    const startedAt = Date.now();
    const reportProgress = (pos: number, dur: number) => {
      if (!onProgress) return;
      if (dur > 0) {
        onProgress(Math.min(1, Math.max(0, pos / dur)), dur);
        return;
      }
      const est = Math.max(400, fallbackDurMs ?? 0);
      if (est <= 0) return;
      const elapsed = Date.now() - startedAt;
      onProgress(Math.min(0.98, Math.max(0, elapsed / est)), est);
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

          const nearEnd = dur > 0 && pos >= Math.max(0, dur - 80);
          if (nearEnd && (handoffReady?.() ?? true)) {
            done();
            return;
          }

          if (status.isPlaying) {
            sawPlaying = true;
            if (pos === lastPos && pos > 0) {
              if (stalledSince == null) stalledSince = Date.now();
              else {
                const stallMs = Date.now() - stalledSince;
                // Am Ende: Android hält isPlaying oft ohne didJustFinish
                const atEnd = dur > 0 && pos >= dur * 0.9;
                if (atEnd && stallMs >= 220) done();
                else if (dur <= 0 && stallMs >= 700) done();
                else if (stallMs >= 2800) done();
              }
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
          // Clip vorbei, Android sendet kein didJustFinish — nicht 2s warten
          if (sawPlaying && !status.isPlaying) {
            if (dur > 0 && pos >= Math.max(0, dur - 80)) {
              done();
              return;
            }
            if (stalledSince == null) stalledSince = Date.now();
            else if (Date.now() - stalledSince >= 180) done();
            return;
          }
          const capMs = (dur > 0 ? dur : 30_000) + 2500;
          if (Date.now() - startedAt >= capMs) done();
        })
        .catch(() => {
          /* ignore poll errors */
        });
    }, 40);

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
        if (dur > 0 && pos >= Math.max(0, dur - 80) && (handoffReady?.() ?? true)) {
          done();
        }
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
 * Cartesia-Warmup während die Bridge noch spricht.
 * Producer der nächsten Session übernimmt fertige Clips — keine zweite Playback-Session.
 * TTS_SENTENCE_PIPELINE_LOCK
 */
const warmByText = new Map<string, Promise<PrefetchBufferItem | 'fail'>>();

export function warmStreamingPhrases(
  text: string,
  voiceId?: VoiceId,
): void {
  const chunks = splitTextToStreamingChunks((text || '').replace(/\s+/g, ' ').trim());
  if (chunks.length === 0) return;
  const keep = new Set(chunks.slice(0, 2));
  for (const [key, p] of [...warmByText.entries()]) {
    if (keep.has(key)) continue;
    warmByText.delete(key);
    void p.then((v) => {
      if (v && v !== 'fail') {
        void unloadSound(v.sound);
        void deleteCartesiaTempAudio(v.uri);
      }
    });
  }
  for (const c of chunks.slice(0, 2)) {
    if (!c || warmByText.has(c)) continue;
    const job = (async (): Promise<PrefetchBufferItem | 'fail'> => {
      try {
        const uri = await synthesizeCartesiaSpeechWav(c, { voiceId });
        if (!uri) return 'fail';
        const item: PrefetchBufferItem = {
          text: c,
          uri,
          sound: null,
          durationMs: peekWavDurationMs(uri),
        };
        void ensurePreload(item);
        return item;
      } catch {
        return 'fail';
      }
    })();
    warmByText.set(c, job);
  }
}

async function takeWarmedClip(display: string): Promise<PrefetchBufferItem | 'fail' | null> {
  const pending = warmByText.get(display);
  if (!pending) return null;
  try {
    const v = await pending;
    warmByText.delete(display);
    return v;
  } catch {
    warmByText.delete(display);
    return 'fail';
  }
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
      if (s.ready.length > 0 || s.producerDone || s.flushed) {
        resolve();
      }
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

  const lookaheadMin = Math.max(1, options.prefetchLookahead ?? DEFAULT_LOOKAHEAD);
  const lookaheadMax = Math.max(
    lookaheadMin,
    options.prefetchLookaheadMax ?? DEFAULT_LOOKAHEAD_MAX,
  );
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
    lookaheadTarget: lookaheadMin,
    lookaheadMax,
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
  if (!options.priorSubtitle) {
    try {
      setSub(null);
    } catch {
      /* ignore */
    }
  }

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

  let synthInflight = 0;
  let wakeSynth: (() => void) | null = null;
  const pendingByIndex = new Map<number, PrefetchBufferItem | 'fail'>();
  let nextEmitIndex = 0;

  const emitReadyInOrder = () => {
    while (pendingByIndex.has(nextEmitIndex)) {
      const v = pendingByIndex.get(nextEmitIndex)!;
      pendingByIndex.delete(nextEmitIndex);
      nextEmitIndex += 1;
      if (v !== 'fail') {
        session.ready.push(v);
        notifyReady(session);
      }
    }
    notifySlot(session);
  };

  const waitSynthCapacity = async () => {
    while (
      !session.flushed &&
      (synthInflight >= MAX_SYNTH_INFLIGHT ||
        session.ready.length >= session.lookaheadTarget)
    ) {
      await new Promise<void>((resolve) => {
        session.wakeSlot = resolve;
        wakeSynth = resolve;
        // Lost-wakeup: Slot/Inflight kann zwischen while-Check und Register frei werden
        if (
          session.flushed ||
          (synthInflight < MAX_SYNTH_INFLIGHT &&
            session.ready.length < session.lookaheadTarget)
        ) {
          resolve();
        }
      });
    }
  };

  const producer = (async () => {
    const running: Promise<void>[] = [];
    try {
      let chunkIndex = 0;
      for await (const display of phraseChunks()) {
        if (!isActive()) break;
        await waitSynthCapacity();
        if (!isActive()) break;
        const index = chunkIndex;
        chunkIndex += 1;
        const job = (async () => {
          synthInflight += 1;
          try {
            const audio = audioOf(display).replace(/\s+/g, ' ').trim();
            // Cartesia lehnt leere / nur-Interpunktion ab — nicht erst 400 riskieren.
            if (!audio || !/[A-Za-zÄÖÜäöüß0-9]/u.test(audio)) {
              pendingByIndex.set(index, 'fail');
              emitReadyInOrder();
              return;
            }
            const warmed = await takeWarmedClip(display);
            if (warmed === 'fail') {
              pendingByIndex.set(index, 'fail');
              emitReadyInOrder();
              return;
            }
            if (warmed) {
              session.temps.push(warmed.uri);
              pendingByIndex.set(index, warmed);
              emitReadyInOrder();
              void ensurePreload(warmed);
              return;
            }
            const generationConfig =
              options.resolveGenerationConfig?.(display, index) ??
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
                  `[stream-queue] Cartesia fail #${index} attempt ${attempt + 1}:`,
                  err,
                );
                if (attempt === 0) {
                  await new Promise((r) => setTimeout(r, 180));
                }
              }
            }
            if (!uri || !isActive()) {
              if (uri) void deleteCartesiaTempAudio(uri);
              pendingByIndex.set(index, 'fail');
              emitReadyInOrder();
              return;
            }
            session.temps.push(uri);
            // URI sofort in die Warteschlange — Preload parallel, nicht vor dem Slot.
            const item: PrefetchBufferItem = {
              text: display,
              uri,
              sound: null,
              durationMs: peekWavDurationMs(uri),
            };
            pendingByIndex.set(index, item);
            emitReadyInOrder();
            void ensurePreload(item);
            if (__DEV__) {
              const emo = generationConfig?.emotion ?? '-';
              console.log(
                `[stream-queue] prefetch #${index} ${Date.now() - t0}ms (${display.length}c) emo=${emo} buf=${session.ready.length} inflight=${synthInflight} «${display.slice(0, 40)}»`,
              );
            }
          } finally {
            synthInflight = Math.max(0, synthInflight - 1);
            const w = wakeSynth;
            wakeSynth = null;
            w?.();
          }
        })();
        running.push(job);
      }
      await Promise.all(running);
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
  let playedCount = 0;
  try {
    // Consumer: gapless handoff — next Sound is preloaded; on didJustFinish
    // we playAsync(next) BEFORE unloading current (same microtask chain).
    let current: PrefetchBufferItem | null = await takeReady(session);
    if (current && options.holdPlayUntil && isActive()) {
      session.lookaheadTarget = session.lookaheadMax;
      notifySlot(session);
      try {
        await options.holdPlayUntil();
      } catch {
        /* ignore */
      }
      session.lookaheadTarget = lookaheadMin;
      notifySlot(session);
    }
    let alreadyPlaying = false;
    const setAudible = (v: boolean) => {
      try {
        options.onAudibleChange?.(v);
      } catch {
        /* ignore */
      }
    };

    const growLookahead = () => {
      playedCount += 1;
      // Während Satz 3 spricht: Ziel wächst → 4 liegt bereit, 5+6 parallel in Cartesia
      session.lookaheadTarget = Math.min(
        session.lookaheadMax,
        lookaheadMin + playedCount,
      );
      notifySlot(session);
    };

    while (current && isActive()) {
      // Puffer schon während dieses Satzes wachsen lassen (nicht erst danach)
      growLookahead();
      try {
        options.onChunkText?.(current.text);
      } catch {
        /* ignore */
      }

      const carry = subtitleCarry;
      const feed = createLiveSubtitleFeed(
        current.text,
        (t) => setSub(mergeSubtitleCarry(carry, t)),
        current.durationMs || estimateSpeechDurationMs(current.text),
      );

      let playing = current.sound;
      if (!playing) {
        playing = await ensurePreload(current);
        if (!playing) {
          current = await takeReady(session);
          alreadyPlaying = false;
          continue;
        }
      }

      session.activeSound = playing;
      options.bindActiveSound?.(playing);

      let nextResolved: PrefetchBufferItem | null | undefined;
      const nextPromise = takeReady(session).then((item) => {
        nextResolved = item;
        if (item) void ensurePreload(item);
        return item;
      });

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
      // Erst mit dem Hörbar-Start — sonst laufen Untertitel der Stimme davon.
      feed.showInitial();

      await waitUntilFinished(
        playing,
        isActive,
        (p, d) => feed.updateProgress(p, d),
        () => nextResolved !== undefined,
        current.durationMs || estimateSpeechDurationMs(current.text),
      );
      feed.showFinal();
      subtitleCarry = mergeSubtitleCarry(subtitleCarry, current.text);

      const next = isActive() ? await nextPromise : null;
      if (!next) setAudible(false);
      const navWantsGap = Boolean(options.peekChunkGap?.() || false);

      if (navWantsGap) {
        // Satzgrenze: aktuellen Clip weg, Navi dazwischen, Rest bleibt bereit
        await unloadSound(playing);
        if (session.activeSound === playing) {
          session.activeSound = null;
          options.bindActiveSound?.(null);
        }
        void deleteCartesiaTempAudio(current.uri);
        await new Promise((r) => setTimeout(r, 500));
        try {
          await options.onChunkGap?.();
        } catch (err) {
          console.warn('[stream-queue] nav gap insert failed:', err);
        }
        current = next;
        alreadyPlaying = false;
        continue;
      }

      if (next) {
        let nextSound = next.sound;
        if (!nextSound) {
          nextSound = await ensurePreload(next);
          if (!nextSound) {
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
