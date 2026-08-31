import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing } from '../../constants/theme';
import type { UserProfile } from '../../types/userProfile';
import {
  considerNameSpeechHint,
  displayNameSpeechSuggestion,
  preferAutoNameSpeechHint,
  previewSentenceForName,
  sanitizeNameSpeechHint,
  speechHintFromTranscript,
  suggestNameSpeechHintWithLlm,
  suggestNameSpeechHints,
} from '../../services/persona/userNameSpeechHint';
import {
  previewUserNamePronunciation,
  stopSpeaking,
} from '../../services/ttsService';
import {
  isCurrentlyListening,
  startListening,
  stopListening,
} from '../../services/sttService';

type Props = {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
};

export function NamePronunciationEditor({ draft, onChange }: Props) {
  const [previewing, setPreviewing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('');
  const [aiSuggested, setAiSuggested] = useState('');
  const partialRef = useRef('');
  const manualRef = useRef(false);
  const considerGen = useRef(0);

  const written = draft.firstName.trim();
  const hint = draft.firstNameSpeechHint ?? '';
  const enabled = draft.firstNameSpeechHintEnabled === true;
  const hintRef = useRef(hint);
  hintRef.current = hint;
  const chips = useMemo(() => suggestNameSpeechHints(written), [written]);
  const suggestion = displayNameSpeechSuggestion(written, aiSuggested);
  const previewLine = previewSentenceForName(suggestion || written);

  const setHint = useCallback(
    (raw: string, source: 'user' | 'auto' = 'user') => {
      const next = sanitizeNameSpeechHint(raw);
      const value =
        next && next.toLowerCase() !== written.toLowerCase() ? next : '';
      if (source === 'user') manualRef.current = true;
      onChange({ firstNameSpeechHint: value });
    },
    [onChange, written],
  );

  const applySuggestion = useCallback(() => {
    if (!suggestion) return;
    const differs = suggestion.toLowerCase() !== written.toLowerCase();
    manualRef.current = true;
    if (differs) {
      onChange({
        firstNameSpeechHint: sanitizeNameSpeechHint(suggestion),
        firstNameSpeechHintEnabled: true,
      });
      setStatus('Vorschlag übernommen — Anhören und bei Bedarf feinjustieren.');
    } else {
      onChange({
        firstNameSpeechHint: '',
        firstNameSpeechHintEnabled: false,
      });
      setStatus('Schreibweise passt — Yorro sagt den Namen wie oben.');
    }
  }, [onChange, suggestion, written]);

  const setEnabled = useCallback(
    (on: boolean) => {
      if (on && !hint) {
        const auto = suggestion || preferAutoNameSpeechHint(written) || '';
        onChange({
          firstNameSpeechHintEnabled: true,
          firstNameSpeechHint:
            auto.toLowerCase() === written.toLowerCase() ? '' : auto,
        });
        return;
      }
      onChange({ firstNameSpeechHintEnabled: on });
    },
    [hint, onChange, suggestion, written],
  );

  const prevWritten = useRef(written);
  useEffect(() => {
    if (prevWritten.current === written) return;
    prevWritten.current = written;
    manualRef.current = false;
    setAiSuggested('');
    if (enabled) onChange({ firstNameSpeechHintEnabled: false });
  }, [enabled, onChange, written]);

  useEffect(() => {
    if (written.length < 2) {
      setAiSuggested('');
      return;
    }
    const gen = (considerGen.current += 1);
    const local = preferAutoNameSpeechHint(written);
    setAiSuggested(local);
    const timer = setTimeout(() => {
      void considerNameSpeechHint(written).then((next) => {
        if (gen !== considerGen.current) return;
        setAiSuggested(next || local);
      });
    }, 450);
    return () => clearTimeout(timer);
  }, [written]);

  useEffect(() => {
    return () => {
      if (isCurrentlyListening()) {
        void stopListening({ tailMs: 0, finalizeMs: 200 });
      }
    };
  }, []);

  const playPreview = useCallback(async () => {
    if (!written) return;
    setPreviewing(true);
    setStatus('');
    try {
      await stopSpeaking();
      const spoken = hint || suggestion || written;
      await previewUserNamePronunciation({
        firstName: written,
        speechHint: spoken,
        voiceId: draft.voiceId,
      });
      setStatus(`Hörprobe: ${previewSentenceForName(spoken)}`);
    } catch (err) {
      console.warn('[namePronunciation] preview:', err);
      setStatus('Probe gerade nicht möglich — gleich nochmal versuchen.');
    } finally {
      setPreviewing(false);
    }
  }, [draft.voiceId, hint, suggestion, written]);

  const runSuggest = useCallback(async () => {
    if (!written) return;
    setSuggesting(true);
    setStatus('');
    try {
      const local = preferAutoNameSpeechHint(written) || written;
      let next = local;
      try {
        const llm = await suggestNameSpeechHintWithLlm(written, hint || local);
        if (llm) next = llm;
      } catch (err) {
        console.warn('[namePronunciation] llm suggest:', err);
      }
      setAiSuggested(next);
      setStatus('Vorschlag aktualisiert — antippen zum Übernehmen.');
    } finally {
      setSuggesting(false);
    }
  }, [hint, written]);

  const toggleListen = useCallback(async () => {
    if (listening || isCurrentlyListening()) {
      setListening(false);
      try {
        const transcript = await stopListening({
          tailMs: 400,
          finalizeMs: 1400,
        });
        const text = transcript.trim() || partialRef.current.trim();
        const fromMic = speechHintFromTranscript(text, written);
        if (fromMic) {
          setHint(fromMic, 'user');
          setStatus(
            enabled
              ? 'Aus der Aufnahme übernommen — Anhören und Feintuning.'
              : 'Übernommen. Schalter an, wenn die Stimme das nutzen soll.',
          );
        } else {
          setStatus('Nichts erkannt. Nochmal sagen oder selbst schreiben.');
        }
      } finally {
        partialRef.current = '';
      }
      return;
    }
    if (!written) {
      setStatus('Zuerst den Vornamen eintragen.');
      return;
    }
    partialRef.current = '';
    setStatus('Sag deinen Namen jetzt.');
    setListening(true);
    const result = await startListening((partial) => {
      partialRef.current = partial;
    });
    if (!result.ok) {
      setListening(false);
      setStatus('Mikrofon gerade nicht verfügbar — Schreibweise selbst eintragen.');
    }
  }, [enabled, listening, setHint, written]);

  const busy = previewing || suggesting;
  const canEdit = written.length > 0;
  const suggestionOn =
    !!suggestion &&
    (hint.toLowerCase() === suggestion.toLowerCase() ||
      (!hint && suggestion.toLowerCase() === written.toLowerCase()));

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Aussprache für die Stimme</Text>
      <Text style={styles.copy}>
        Oben steht der Vorname wie geschrieben. Darunter der Vorschlag, wie
        Yorro ihn sagen soll — antippen übernimmt ihn.
      </Text>
      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <Text style={styles.switchTitle}>
            {enabled ? 'Angepasst an' : 'Angepasst aus'}
          </Text>
          <Text style={styles.switchHint}>
            {enabled
              ? 'Die Umschreibung unten kommt in die Stimme.'
              : 'Yorro sagt den Namen wie im Namensfeld.'}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          disabled={!canEdit}
          trackColor={{ false: 'rgba(255,255,255,0.18)', true: colors.accent }}
          thumbColor={colors.text}
          accessibilityLabel="Angepasste Aussprache"
        />
      </View>
      <TextInput
        style={styles.input}
        placeholder={written ? `z. B. ${suggestion || written}` : 'Zuerst Vorname'}
        placeholderTextColor={colors.textMuted}
        value={hint}
        onChangeText={(raw) => setHint(raw, 'user')}
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        showSoftInputOnFocus
        editable={canEdit}
        accessibilityLabel="Aussprache-Umschreibung"
      />
      {canEdit && suggestion ? (
        <Pressable
          onPress={applySuggestion}
          style={[styles.suggestCard, suggestionOn && styles.suggestCardOn]}
          accessibilityRole="button"
          accessibilityLabel={`Vorschlag ${suggestion} übernehmen`}
        >
          <View style={styles.suggestCopy}>
            <Text style={styles.suggestKicker}>Vorschlag</Text>
            <Text style={styles.suggestName}>{suggestion}</Text>
            {previewLine ? (
              <Text style={styles.suggestPreview}>{previewLine}</Text>
            ) : null}
          </View>
          <Text style={styles.suggestAction}>
            {suggestionOn ? 'Aktiv' : 'Übernehmen'}
          </Text>
        </Pressable>
      ) : null}
      {chips.filter((item) => item.toLowerCase() !== suggestion.toLowerCase())
        .length > 0 ? (
        <View style={styles.chipRow}>
          {chips
            .filter((item) => item.toLowerCase() !== suggestion.toLowerCase())
            .map((item) => {
              const on = hint.toLowerCase() === item.toLowerCase();
              return (
                <Pressable
                  key={item}
                  onPress={() => setHint(item, 'user')}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                    {item}
                  </Text>
                </Pressable>
              );
            })}
        </View>
      ) : null}
      <View style={styles.btnRow}>
        <Pressable
          onPress={() => void playPreview()}
          disabled={!canEdit || busy}
          style={[styles.btn, (!canEdit || busy) && styles.btnOff]}
          accessibilityRole="button"
          accessibilityLabel="Aussprache anhören"
        >
          {previewing ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={styles.btnLabel}>Anhören</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => void runSuggest()}
          disabled={!canEdit || busy}
          style={[styles.btn, (!canEdit || busy) && styles.btnOff]}
          accessibilityRole="button"
          accessibilityLabel="Aussprache-Vorschlag neu berechnen"
        >
          {suggesting ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={styles.btnLabel}>Neu vorschlagen</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => void toggleListen()}
          disabled={!canEdit || busy}
          style={[
            styles.btn,
            listening && styles.btnLive,
            (!canEdit || busy) && styles.btnOff,
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            listening ? 'Aufnahme stoppen' : 'Namen einsprechen'
          }
        >
          <Text style={[styles.btnLabel, listening && styles.btnLabelLive]}>
            {listening ? 'Stopp' : 'Einsprechen'}
          </Text>
        </Pressable>
      </View>
      {hint ? (
        <Pressable
          onPress={() => {
            setHint('', 'user');
            if (enabled) onChange({ firstNameSpeechHintEnabled: false });
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Aussprache zurücksetzen"
        >
          <Text style={styles.reset}>Geschriebene Form wieder nutzen</Text>
        </Pressable>
      ) : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
    marginTop: 4,
  },
  label: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  copy: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  switchCopy: {
    flex: 1,
  },
  switchTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  switchHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  input: {
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  suggestCardOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.15)',
  },
  suggestCopy: {
    flex: 1,
    gap: 2,
  },
  suggestKicker: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  suggestName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  suggestPreview: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  suggestAction: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.15)',
  },
  chipLabel: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  chipLabelOn: {
    color: colors.accent,
  },
  btnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  btn: {
    flexGrow: 1,
    minWidth: '28%',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  btnOff: {
    opacity: 0.45,
  },
  btnLive: {
    borderColor: colors.danger,
    backgroundColor: 'rgba(200, 70, 70, 0.16)',
  },
  btnLabel: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  btnLabelLive: {
    color: colors.danger,
  },
  reset: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  status: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
});
