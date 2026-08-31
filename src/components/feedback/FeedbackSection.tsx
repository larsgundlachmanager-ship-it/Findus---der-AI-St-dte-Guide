import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing } from '../../constants/theme';
import { PrimaryButton, SecondaryButton } from '../../onboarding/OnboardingUI';
import { getDatabase } from '../../db/database';
import {
  countUnsentFeedbackEntries,
  insertFeedbackEntry,
} from '../../db/feedbackEntries';
import { uploadPendingFeedback } from '../../services/feedback/feedbackUploadService';
import {
  recordLastAction,
  snapshotTelemetry,
} from '../../services/feedback/telemetryBuffer';
import {
  isCurrentlyListening,
  startListening,
  stopListening,
} from '../../services/sttService';
import { showPermissionMissingAlert } from '../../utils/permissionAlerts';
import { getCachedUserProfile } from '../../services/userProfileService';

type ActiveField = 'issue' | 'desired';

type Props = {
  defaultUserName?: string;
};

export function FeedbackSection({ defaultUserName = '' }: Props) {
  const [userName, setUserName] = useState(defaultUserName);
  const [issueDescription, setIssueDescription] = useState('');
  const [desiredBehavior, setDesiredBehavior] = useState('');
  const [activeField, setActiveField] = useState<ActiveField>('issue');
  const [pendingCount, setPendingCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const partialRef = useRef('');

  const refreshPendingCount = useCallback(async () => {
    const db = await getDatabase();
    const count = await countUnsentFeedbackEntries(db);
    setPendingCount(count);
  }, []);

  useEffect(() => {
    setUserName((cur) => cur || defaultUserName);
  }, [defaultUserName]);

  useEffect(() => {
    void refreshPendingCount();
    recordLastAction('feedback_section_view');
  }, [refreshPendingCount]);

  const appendToField = useCallback(
    (field: ActiveField, text: string) => {
      const chunk = text.trim();
      if (!chunk) return;
      if (field === 'issue') {
        setIssueDescription((cur) => (cur ? `${cur} ${chunk}` : chunk));
      } else {
        setDesiredBehavior((cur) => (cur ? `${cur} ${chunk}` : chunk));
      }
    },
    [],
  );

  const startVoiceCapture = useCallback(async () => {
    const profile = getCachedUserProfile();
    if (!profile?.hasAcceptedAudioConsent || profile?.micListenMode !== 'hear') {
      showPermissionMissingAlert('audioConsent', { force: true });
      return;
    }

    partialRef.current = '';
    setIsListening(true);
    recordLastAction('feedback_mic_start');

    const result = await startListening((partial: string) => {
      partialRef.current = partial;
    });

    if (!result.ok) {
      setIsListening(false);
    }
  }, []);

  const stopVoiceCapture = useCallback(async () => {
    if (!isListening && !isCurrentlyListening()) return;

    setIsListening(false);
    try {
      const transcript = await stopListening({ tailMs: 400, finalizeMs: 1200 });
      const text = transcript.trim() || partialRef.current.trim();
      if (text) {
        appendToField(activeField, text);
        recordLastAction(`feedback_voice_${activeField}`);
      }
    } finally {
      partialRef.current = '';
    }
  }, [activeField, appendToField, isListening]);

  const handleSave = useCallback(async () => {
    if (!issueDescription.trim() && !desiredBehavior.trim()) {
      Alert.alert(
        'Feedback',
        'Bitte beschreibe kurz, was schiefgelaufen ist oder was du dir gewünscht hättest.',
      );
      return;
    }

    setIsSaving(true);
    try {
      const db = await getDatabase();
      await insertFeedbackEntry(db, {
        userName: userName.trim() || 'Tester / User',
        issueDescription,
        desiredBehavior,
        telemetry: snapshotTelemetry(),
      });
      setIssueDescription('');
      setDesiredBehavior('');
      await refreshPendingCount();
      recordLastAction('feedback_saved_local');
      Alert.alert(
        'Gespeichert',
        'Feedback liegt auf diesem Gerät. Abends wird es automatisch in die Cloud gelegt — du musst nicht extra auf Upload drücken.',
      );
    } catch (err) {
      Alert.alert(
        'Fehler',
        err instanceof Error ? err.message : 'Speichern fehlgeschlagen.',
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    desiredBehavior,
    issueDescription,
    refreshPendingCount,
    userName,
  ]);

  const handleUpload = useCallback(async () => {
    setIsUploading(true);
    try {
      const result = await uploadPendingFeedback();
      await refreshPendingCount();
      recordLastAction('feedback_uploaded');
      Alert.alert(
        'Upload erfolgreich',
        `${result.uploadedCount} Eintrag/Einträge hochgeladen. Lokaler Cache wurde geleert.`,
      );
    } catch (err) {
      Alert.alert(
        'Upload fehlgeschlagen',
        err instanceof Error
          ? err.message
          : 'Bitte später erneut versuchen.',
      );
    } finally {
      setIsUploading(false);
    }
  }, [refreshPendingCount]);

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Feedback & Fehler melden</Text>
      <Text style={styles.hint}>
        Hilf uns, Yorro zu verbessern. Speichern reicht — nach 21 Uhr wird
        ausstehendes Feedback automatisch hochgeladen (nicht ständig, nur
        abends). Optional kannst du trotzdem sofort uploaden. Es gehen die
        letzten 10 Minuten Telemetrie mit.
      </Text>

      <Text style={styles.label}>Dein Name</Text>
      <TextInput
        style={styles.input}
        value={userName}
        onChangeText={setUserName}
        placeholder="Tester / User"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="words"
      />

      <Text style={styles.label}>Was ist schiefgelaufen?</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={issueDescription}
        onChangeText={setIssueDescription}
        onFocus={() => setActiveField('issue')}
        placeholder="Beschreibe den Fehler oder das unerwartete Verhalten…"
        placeholderTextColor={colors.textMuted}
        multiline
        textAlignVertical="top"
      />

      <Text style={styles.label}>Was hättest du dir gewünscht?</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={desiredBehavior}
        onChangeText={setDesiredBehavior}
        onFocus={() => setActiveField('desired')}
        placeholder="Ideales Verhalten oder Erwartung…"
        placeholderTextColor={colors.textMuted}
        multiline
        textAlignVertical="top"
      />

      <View style={styles.micRow}>
        <Pressable
          onPressIn={() => void startVoiceCapture()}
          onPressOut={() => void stopVoiceCapture()}
          style={[styles.micBtn, isListening && styles.micBtnActive]}
          accessibilityRole="button"
          accessibilityLabel="Mikrofon gedrückt halten zum Diktieren"
        >
          {isListening ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Text style={styles.micIcon}>🎙</Text>
          )}
        </Pressable>
        <View style={styles.micCopy}>
          <Text style={styles.micTitle}>
            {isListening ? 'Sprich jetzt…' : 'Mikro gedrückt halten'}
          </Text>
          <Text style={styles.micHint}>
            Füllt das aktive Feld (
            {activeField === 'issue' ? 'Problem' : 'Wunsch'})
          </Text>
        </View>
      </View>

      <Text style={styles.pendingLabel}>
        {pendingCount === 0
          ? 'Kein ausstehendes Feedback'
          : `${pendingCount} Eintrag/Einträge lokal — Upload abends automatisch`}
      </Text>

      <View style={styles.actions}>
        <SecondaryButton
          label={isSaving ? 'Speichere…' : 'Lokal speichern'}
          onPress={() => {
            if (!isSaving) void handleSave();
          }}
        />
        <View style={styles.actionGap} />
        <PrimaryButton
          label={isUploading ? 'Upload läuft…' : 'Jetzt uploaden'}
          onPress={() => {
            if (!isUploading) void handleUpload();
          }}
          disabled={isUploading || pendingCount === 0}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    gap: 8,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
  multiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  micRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  micBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  micBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  micIcon: {
    fontSize: 24,
  },
  micCopy: {
    flex: 1,
    gap: 2,
  },
  micTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  micHint: {
    color: colors.textMuted,
    fontSize: 12,
  },
  pendingLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  actions: {
    marginTop: 4,
    gap: 8,
  },
  actionGap: {
    height: 4,
  },
});
