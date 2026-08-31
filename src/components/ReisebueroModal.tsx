import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { SwipeBackView } from './SwipeBackView';
import { runBriefingReply, runOpeningGreeting } from '../reisebuero/briefingChat';
import { isBriefComplete, searchReadyGaps } from '../reisebuero/completeness';
import { isOpenAskKey } from '../reisebuero/reisebueroEndpoint';
import {
  buildFlipchartNotes,
  flipchartBudget,
  type FlipchartNote,
  type NoteTier,
} from '../reisebuero/flipchartNotes';
import {
  isReisebueroMicHeldForTts,
  pauseReisebueroMicForTts,
  pauseReisebueroMicForTyping,
  resumeReisebueroMicAfterTts,
  resumeReisebueroMicAfterTyping,
  startReisebueroMic,
  stopReisebueroMic,
  subscribeReisebueroMic,
  type ReisebueroMicPhase,
} from '../reisebuero/reisebueroLiveMic';
import { runReisebueroFunnel } from '../reisebuero/research/funnel';
import { useReisebueroStore } from '../reisebuero/store';
import type { FactThumb, ReiseOption } from '../reisebuero/types';
import { speakRuntimeText } from '../runtime/speechModule';
import { setMicVadTtsGate } from '../services/handsFree/micVad';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export const ReisebueroModal = React.memo(function ReisebueroModal({
  visible,
  onClose,
}: Props) {
  const trip = useReisebueroStore((s) => s.trip);
  const ingest = useReisebueroStore((s) => s.ingestUserText);
  const selectOption = useReisebueroStore((s) => s.selectOption);
  const bumpRefine = useReisebueroStore((s) => s.bumpRefine);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState('');
  const [micPhase, setMicPhase] = useState<ReisebueroMicPhase>('idle');
  const [kbHeight, setKbHeight] = useState(0);
  const kbOpen = kbHeight > 40;
  const lastKb = useRef(300);
  const booted = useRef(false);
  const busyRef = useRef(false);
  const typingRef = useRef(false);
  const pendingRef = useRef<string[]>([]);
  const inputRef = useRef<TextInput>(null);
  const sendHoldRef = useRef(false);
  const selected = trip.options.find((o) => o.id === trip.selectedOptionId) ?? null;
  const ready = isBriefComplete(trip.ledger);
  const notes = useMemo(() => buildFlipchartNotes(trip.ledger), [trip.ledger]);
  const budget = useMemo(() => flipchartBudget(trip.ledger), [trip.ledger]);
  const questionHint = trip.questionHint;
  const listening = micPhase === 'listening' || micPhase === 'processing';
  const prevNoteIds = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  const handleRef = useRef<(text: string) => Promise<void>>(async () => {});
  const handleUtterance = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      if (useReisebueroStore.getState().trip.frozen) return;
      ingest(t);
      busyRef.current = true;
      setBusy(true);
      const micOwnsTts = isReisebueroMicHeldForTts();
      try {
        setMicVadTtsGate(true);
        if (!micOwnsTts) await pauseReisebueroMicForTts();
        const speech = await runBriefingReply();
        try {
          await speakRuntimeText(speech);
        } catch {
          /* Mic muss trotzdem wieder an */
        }
        const after = useReisebueroStore.getState().trip;
        if (
          after.ledger.recapDone?.value &&
          isBriefComplete(after.ledger) &&
          !after.searching &&
          !after.options.length
        ) {
          await runReisebueroFunnel();
        }
      } finally {
        setMicVadTtsGate(false);
        busyRef.current = false;
        setBusy(false);
        if (!micOwnsTts && !typingRef.current) await resumeReisebueroMicAfterTts();
        const queued = pendingRef.current.shift();
        if (queued) void handleRef.current(queued);
      }
    },
    [ingest],
  );
  handleRef.current = handleUtterance;

  const micHandlers = useCallback(
    () => ({
      onUtterance: (text: string) => handleRef.current(text),
      onPartial: setPartial,
      onPhase: setMicPhase,
      getAskContext: () => {
        const t = useReisebueroStore.getState().trip;
        const lastAsk = t.askedSlotKeys[t.askedSlotKeys.length - 1] ?? null;
        return {
          turnIndex: t.chat.filter((c) => c.role === 'user').length,
          lastAskOpen: isOpenAskKey(lastAsk) || t.chat.filter((c) => c.role === 'user').length < 2,
        };
      },
    }),
    [],
  );

  useEffect(() => {
    const ids = notes.map((n) => n.id);
    const added = ids.filter((id) => !prevNoteIds.current.has(id));
    prevNoteIds.current = new Set(ids);
    if (!added.length) return;
    setFreshIds(new Set(added));
    const t = setTimeout(() => setFreshIds(new Set()), 5000);
    return () => clearTimeout(t);
  }, [notes]);

  useEffect(() => {
    return subscribeReisebueroMic((_on, phase) => setMicPhase(phase));
  }, []);

  useEffect(() => {
    if (!visible) {
      setKbHeight(0);
      typingRef.current = false;
      return;
    }
    const applyKb = (h: number) => {
      const n = Math.max(0, h);
      if (n > 80) lastKb.current = n;
      setKbHeight(n);
    };
    const show = Keyboard.addListener('keyboardDidShow', (e) => applyKb(e.endCoordinates.height));
    const will = Keyboard.addListener('keyboardWillShow', (e) => applyKb(e.endCoordinates.height));
    const frame = Keyboard.addListener('keyboardDidChangeFrame', (e) => {
      const h = e.endCoordinates.height;
      if (h > 80) applyKb(h);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKbHeight(0);
      typingRef.current = false;
      if (busyRef.current || sendHoldRef.current || isReisebueroMicHeldForTts()) return;
      void resumeReisebueroMicAfterTyping();
    });
    return () => {
      show.remove();
      will.remove();
      frame.remove();
      hide.remove();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      booted.current = false;
      void stopReisebueroMic();
      return;
    }
    let cancelled = false;
    void (async () => {
      if (booted.current) return;
      booted.current = true;
      const snapshot = useReisebueroStore.getState().trip;
      const last = snapshot.chat[snapshot.chat.length - 1];
      setBusy(true);
      busyRef.current = true;
      try {
        setMicVadTtsGate(true);
        if (!snapshot.chat.length) {
          const speech = await runOpeningGreeting();
          await speakRuntimeText(speech);
        } else if (last?.role === 'user') {
          const speech = await runBriefingReply();
          await speakRuntimeText(speech);
        }
      } finally {
        setMicVadTtsGate(false);
        busyRef.current = false;
        setBusy(false);
      }
      // Explizites Reisebüro → sofort Live-Chat: Mic an nach Begrüßung
      if (!cancelled) {
        const res = await startReisebueroMic(micHandlers());
        if (!res.ok && res.message) {
          console.warn('[Reisebuero] auto-mic:', res.message);
        }
      }
    })();
    return undefined;
  }, [visible, micHandlers]);

  const send = useCallback(async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    sendHoldRef.current = true;
    Keyboard.dismiss();
    inputRef.current?.blur();
    if (busyRef.current) {
      pendingRef.current.push(t);
      sendHoldRef.current = false;
      return;
    }
    try {
      await handleUtterance(t);
    } finally {
      sendHoldRef.current = false;
    }
  }, [draft, handleUtterance]);

  const onInputFocus = useCallback(() => {
    typingRef.current = true;
    sendHoldRef.current = false;
    setKbHeight((h) => (h > 80 ? h : lastKb.current));
    void pauseReisebueroMicForTyping();
  }, []);

  const onInputBlur = useCallback(() => {
    if (busyRef.current || sendHoldRef.current || isReisebueroMicHeldForTts()) return;
    typingRef.current = false;
    void resumeReisebueroMicAfterTyping();
  }, []);

  const toggleMic = useCallback(async () => {
    if (listening) {
      await stopReisebueroMic();
      setPartial('');
      return;
    }
    const res = await startReisebueroMic(micHandlers());
    if (!res.ok && res.message) {
      Alert.alert('Mikrofon', res.message);
    }
  }, [listening, micHandlers]);

  const runSearch = useCallback(async () => {
    setBusy(true);
    await runReisebueroFunnel();
    setBusy(false);
  }, []);

  const search = useCallback(() => {
    if (trip.searching) return;
    if (ready) {
      void runSearch();
      return;
    }
    const missing = searchReadyGaps(trip.ledger)
      .map((g) => g.label)
      .join(', ');
    Alert.alert(
      'Noch nicht alle Infos',
      missing
        ? `Es fehlt noch: ${missing}. Trotzdem suchen?`
        : 'Noch nicht alles notiert. Trotzdem suchen?',
      [
        { text: 'Weiter erzählen', style: 'cancel' },
        { text: 'Trotzdem suchen', onPress: () => void runSearch() },
      ],
    );
  }, [ready, runSearch, trip.ledger, trip.searching]);

  const close = useCallback(() => {
    void stopReisebueroMic();
    onClose();
  }, [onClose]);

  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.sheet}>
      <SwipeBackView enabled onBack={close} style={styles.flex} captureHardwareBack>
        <SafeAreaView
          style={[styles.safe, kbHeight > 0 ? { marginBottom: kbHeight } : null]}
          edges={kbOpen ? ['top'] : ['top', 'bottom']}
        >
          <View style={styles.top}>
            <Pressable onPress={close} accessibilityLabel="Schließen" style={styles.iconBtn}>
              <Feather name="x" size={22} color={colors.text} />
            </Pressable>
            <Text style={styles.title}>Yorro Reisebüro</Text>
            <View style={styles.iconBtn} />
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {questionHint ? <Text style={styles.questionHint}>{questionHint}</Text> : null}

            <FlipchartBoard notes={notes} freshIds={freshIds} />

            {busy && !trip.searching ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 6 }} />
            ) : null}

            {trip.searchError ? <Text style={styles.err}>{trip.searchError}</Text> : null}

            {trip.options.length ? (
              <View style={styles.tiles}>
                {trip.options.map((opt) => (
                  <OptionCard
                    key={opt.id}
                    opt={opt}
                    selected={opt.id === trip.selectedOptionId}
                    onPress={() => selectOption(opt.id === trip.selectedOptionId ? null : opt.id)}
                  />
                ))}
                <Pressable onPress={bumpRefine} style={styles.refineBtn}>
                  <Text style={styles.refineText}>Brief ändern</Text>
                </Pressable>
              </View>
            ) : null}

            {selected ? <OptionStory opt={selected} onClose={() => selectOption(null)} /> : null}
          </ScrollView>

          <View style={[styles.composer, kbOpen ? styles.composerKb : null]}>
            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Antwort tippen…"
                placeholderTextColor={colors.textMuted}
                editable={true}
                onFocus={onInputFocus}
                onBlur={onInputBlur}
                onSubmitEditing={() => void send()}
                blurOnSubmit
                submitBehavior="submit"
                returnKeyType="send"
                enablesReturnKeyAutomatically
                testID="reisebueroTypeInput"
              />
              <Pressable
                onPress={() => void send()}
                style={styles.send}
                accessibilityLabel="Senden"
              >
                <Feather name="send" size={18} color={colors.bg} />
              </Pressable>
            </View>

            {kbOpen ? null : (
              <>
                <Pressable
                  onPress={search}
                  disabled={trip.searching}
                  style={[
                    styles.searchBtn,
                    ready && !trip.searching ? styles.searchBtnOn : styles.searchBtnOff,
                  ]}
                >
                  <Text
                    style={[
                      styles.searchBtnText,
                      ready ? styles.searchBtnTextOn : styles.searchBtnTextOff,
                    ]}
                  >
                    {trip.searching ? 'Suche…' : 'Suche starten'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => void toggleMic()}
                  disabled={trip.frozen && !listening}
                  style={[styles.micBtn, listening ? styles.micBtnOn : styles.micBtnOff]}
                  accessibilityLabel={listening ? 'Mikrofon stummschalten' : 'Mikrofon einschalten'}
                >
                  <Feather name={listening ? 'stop-circle' : 'mic'} size={28} color={colors.bg} />
                  <Text style={styles.micLabel}>
                    {micPhase === 'processing'
                      ? 'Notiere…'
                      : listening
                        ? 'Ich höre zu — tippen zum Stummschalten'
                        : 'Mikro aus — tippen zum Zuhören'}
                  </Text>
                </Pressable>
                {partial && listening ? <Text style={styles.partial}>{partial}</Text> : null}
              </>
            )}
          </View>
        </SafeAreaView>
      </SwipeBackView>
      </View>
    </View>
  );
});

function FlipchartBoard({ notes, freshIds }: { notes: FlipchartNote[]; freshIds: Set<string> }) {
  const empty = !notes.length;

  return (
    <View style={styles.board}>
      {empty ? (
        <Text style={styles.boardEmpty}>Noch leer — red drauf los, ich schreib mit.</Text>
      ) : (
        <>
          <View style={styles.legend}>
            <Text style={styles.legendMust}>grün muss</Text>
            <Text style={styles.legendWish}>gelb Wunsch</Text>
            <Text style={styles.legendOpt}>weiß optional</Text>
            <Text style={styles.legendNope}>rot No-Go</Text>
          </View>
          <View style={styles.noteRow}>
            {notes.map((n, i) => (
              <NoteSticker
                key={n.id}
                note={n}
                tilt={i % 2 === 0 ? -2.5 : 2.2}
                fresh={freshIds.has(n.id)}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function NoteSticker({
  note,
  tilt,
  fresh,
}: {
  note: FlipchartNote;
  tilt: number;
  fresh?: boolean;
}) {
  return (
    <View
      style={[
        styles.sticker,
        tierStyle(note.tier),
        fresh ? styles.stickerFresh : null,
        { transform: [{ rotate: `${tilt}deg` }] },
      ]}
    >
      <Text style={styles.stickerEmoji}>{note.emoji}</Text>
      <Text style={styles.stickerLabel} numberOfLines={2}>
        {note.label}
      </Text>
    </View>
  );
}

function tierStyle(tier: NoteTier) {
  if (tier === 'critical') return styles.stickerMust;
  if (tier === 'nope') return styles.stickerNope;
  if (tier === 'optional') return styles.stickerOptional;
  return styles.stickerSoft;
}

function OptionCard({
  opt,
  selected,
  onPress,
}: {
  opt: ReiseOption;
  selected: boolean;
  onPress: () => void;
}) {
  const scoreColor =
    opt.matchScore >= 92 ? colors.online : opt.matchScore >= 80 ? colors.accent : colors.danger;
  return (
    <Pressable onPress={onPress} style={[styles.card, selected && styles.cardOn]}>
      <View style={styles.cardTop}>
        {opt.photoUrl ? (
          <Image source={{ uri: opt.photoUrl }} style={styles.cardImg} />
        ) : (
          <View style={[styles.cardImg, styles.tileImgPh]} />
        )}
        <View style={[styles.match, { borderColor: scoreColor }]}>
          <Text style={[styles.matchPct, { color: scoreColor }]}>{opt.matchScore}%</Text>
          <Text style={styles.matchCap}>Match</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{opt.title}</Text>
        <Text style={styles.cardPlace}>{opt.placeName}</Text>
        {opt.pricePerPerson != null ? (
          <Text style={styles.cardPrice}>
            €{opt.pricePerPerson} p.P.
            {opt.priceIncludes ? ` · ${opt.priceIncludes}` : ''}
          </Text>
        ) : (
          <Text style={styles.cardPriceMuted}>Preis live offen</Text>
        )}
        {opt.restBudgetEur != null && opt.restBudgetEur > 0 ? (
          <Text style={styles.cardRest}>
            Rest €{opt.restBudgetEur}
            {opt.restBudgetHint ? ` (${opt.restBudgetHint})` : ''}
          </Text>
        ) : null}
        {opt.facts.length ? <FactRow facts={opt.facts} /> : null}
        <Text style={styles.cardWhy}>{opt.whyBlurb}</Text>
      </View>
    </Pressable>
  );
}

function FactRow({ facts }: { facts: FactThumb[] }) {
  return (
    <View style={styles.facts}>
      {facts.map((f) => (
        <View key={f.id} style={[styles.fact, f.met ? styles.factMet : styles.factMiss]}>
          <Text style={styles.factEmoji}>{f.emoji}</Text>
          <Feather
            name={f.met ? 'thumbs-up' : 'thumbs-down'}
            size={12}
            color={f.met ? colors.online : colors.danger}
          />
        </View>
      ))}
    </View>
  );
}

function OptionStory({
  opt,
  onClose,
}: {
  opt: ReiseOption;
  onClose: () => void;
}) {
  return (
    <View style={styles.story}>
      <Pressable onPress={onClose} style={styles.storyClose}>
        <Text style={styles.refineText}>Kachel schließen</Text>
      </Pressable>
      <Text style={styles.cardWhy}>{opt.whyBlurb}</Text>
      {opt.stayBookUrl ? (
        <Pressable onPress={() => void Linking.openURL(opt.stayBookUrl!)} style={styles.linkBtn}>
          <Text style={styles.linkText}>Unterkunft öffnen</Text>
        </Pressable>
      ) : null}
      {opt.flightBookUrl ? (
        <Pressable onPress={() => void Linking.openURL(opt.flightBookUrl!)} style={styles.linkBtn}>
          <Text style={styles.linkText}>Flug vergleichen</Text>
        </Pressable>
      ) : null}
      {opt.carBookUrl ? (
        <Pressable onPress={() => void Linking.openURL(opt.carBookUrl!)} style={styles.linkBtn}>
          <Text style={styles.linkText}>Mietwagen</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.overlay,
    backgroundColor: 'rgba(8,20,16,0.55)',
  },
  sheet: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  safe: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.md, paddingBottom: 24, gap: 12 },
  questionHint: {
    color: colors.accent,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  board: {
    minHeight: 120,
    paddingVertical: spacing.sm,
    gap: 10,
  },
  boardEmpty: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 28 },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 4,
  },
  legendMust: { color: 'rgba(61,207,122,0.95)', fontSize: 11, fontWeight: '700' },
  legendWish: { color: 'rgba(234,179,8,0.95)', fontSize: 11, fontWeight: '700' },
  legendOpt: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700' },
  legendNope: { color: 'rgba(217,107,92,0.95)', fontSize: 11, fontWeight: '700' },
  noteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  sticker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: '100%',
  },
  stickerMust: {
    backgroundColor: 'rgba(61,207,122,0.28)',
    borderColor: 'rgba(61,207,122,1)',
  },
  stickerSoft: {
    backgroundColor: 'rgba(234,179,8,0.22)',
    borderColor: 'rgba(234,179,8,0.95)',
  },
  stickerOptional: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.85)',
  },
  stickerNope: {
    backgroundColor: 'rgba(217,107,92,0.22)',
    borderColor: 'rgba(217,107,92,0.9)',
  },
  stickerFresh: {
    borderWidth: 4,
    borderColor: '#3B82F6',
  },
  stickerEmoji: { fontSize: 18 },
  stickerLabel: { color: colors.text, fontWeight: '800', fontSize: 13 },
  err: { color: colors.danger, fontSize: 13 },
  tiles: { gap: 14, marginTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardOn: { borderColor: colors.accent },
  cardTop: { position: 'relative' },
  cardImg: { width: '100%', height: 158, backgroundColor: colors.bgElevated },
  tileImgPh: { backgroundColor: colors.bgElevated },
  match: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    backgroundColor: 'rgba(15,44,36,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchPct: { fontWeight: '800', fontSize: 16 },
  matchCap: { color: colors.textMuted, fontSize: 9, fontWeight: '700' },
  cardBody: { padding: spacing.sm, gap: 4 },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: 17 },
  cardPlace: { color: colors.textMuted, fontSize: 13 },
  cardPrice: { color: colors.text, fontWeight: '800', fontSize: 15, marginTop: 2 },
  cardPriceMuted: { color: colors.textMuted, fontWeight: '600' },
  cardRest: { color: colors.wave, fontSize: 12, fontWeight: '600' },
  cardWhy: { color: colors.text, fontSize: 13, lineHeight: 18, marginTop: 4, fontStyle: 'italic' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  factMet: { backgroundColor: 'rgba(61,207,122,0.16)' },
  factMiss: { backgroundColor: 'rgba(217,107,92,0.16)' },
  factEmoji: { fontSize: 14 },
  refineBtn: { alignSelf: 'center', padding: 8 },
  refineText: { color: colors.accent, fontWeight: '700' },
  story: {
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    padding: spacing.md,
    gap: 10,
  },
  storyClose: { alignSelf: 'flex-end' },
  linkBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkText: { color: colors.bg, fontWeight: '800' },
  composer: {
    padding: spacing.md,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  composerKb: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  searchBtn: { borderRadius: 12, paddingVertical: 8, alignItems: 'center' },
  searchBtnOn: { backgroundColor: colors.online },
  searchBtnOff: {
    backgroundColor: colors.accent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  searchBtnText: { fontWeight: '700', fontSize: 13 },
  searchBtnTextOn: { color: colors.bg },
  searchBtnTextOff: { color: colors.bg },
  micBtn: {
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  micBtnOn: { backgroundColor: colors.online },
  micBtnOff: { backgroundColor: colors.accent },
  micLabel: { color: colors.bg, fontWeight: '800', fontSize: 14, flexShrink: 1 },
  partial: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic', paddingHorizontal: 4 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
