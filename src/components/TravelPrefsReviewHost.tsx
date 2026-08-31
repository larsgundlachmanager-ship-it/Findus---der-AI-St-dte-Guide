/**
 * Overlay: Aktuelle Reise nach Stadtwechsel oder langer Pause.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';
import { ConciergePrefsEditor } from './ConciergePrefsEditor';
import type { UserProfile } from '../types/userProfile';
import {
  clearPendingTravelPrefsReview,
  markTravelPrefsReviewed,
  subscribeTravelPrefsReview,
} from '../services/memory/travelPrefsReview';
import { PrimaryButton } from '../onboarding/OnboardingUI';

type Props = {
  profile: UserProfile;
  onSave: (patch: Partial<UserProfile>) => void | Promise<void>;
};

export function TravelPrefsReviewHost({ profile, onSave }: Props) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<{
    reason: 'city' | 'idle';
    cityId?: string;
  } | null>(null);
  const [draft, setDraft] = useState(profile);

  useEffect(() => {
    return subscribeTravelPrefsReview((p) => {
      setDraft(profile);
      setOpen(p);
      try {
        const {
          useLivePitchStore,
        } = require('../module2/pitch/publishPitchUi') as {
          useLivePitchStore: { getState: () => { clear: () => void } };
        };
        useLivePitchStore.getState().clear();
      } catch {
        /* soft */
      }
    });
  }, [profile]);

  useEffect(() => {
    if (open) setDraft(profile);
  }, [open, profile]);

  const close = () => {
    clearPendingTravelPrefsReview();
    setOpen(null);
  };

  /** Später / Zurück / Backdrop: Sheet weg und nicht sofort wieder aufpoppen. */
  const dismissForNow = () => {
    void markTravelPrefsReviewed().finally(() => {
      close();
    });
  };

  if (!open) return null;

  const title =
    open.reason === 'city'
      ? 'Aktuelle Reise — neue Stadt'
      : 'Aktuelle Reise aktualisieren';
  const lead =
    open.reason === 'city'
      ? 'Neue Stadt — kurz checken: Reisezweck, Begleitung, Anreise, Budget und Startpunkt (Zuhause hier oder Hotel/Adresse).'
      : 'Lange keine aktive Nutzung — stimmen Reisezweck, Begleitung, Mobilität, Budget und Unterkunft noch?';

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={dismissForNow}
      statusBarTranslucent
    >
      <View style={styles.overlay} pointerEvents="auto">
        <Pressable
          style={styles.backdrop}
          onPress={dismissForNow}
          accessibilityLabel="Schließen"
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              onPress={dismissForNow}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Später"
            >
              <Text style={styles.close}>Später ✕</Text>
            </Pressable>
          </View>
          <Text style={styles.lead}>{lead}</Text>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
          >
            <ConciergePrefsEditor
              draft={draft}
              onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
              scope="trip"
              compact
            />
          </ScrollView>
          <PrimaryButton
            label="Passt so"
            onPress={() => {
              void Promise.resolve(
                onSave({
                  travelParty: draft.travelParty,
                  mobilityMode: draft.mobilityMode,
                  energyLevel: draft.energyLevel,
                  budgetCategory: draft.budgetCategory,
                  tourLengthPref: draft.tourLengthPref,
                  touristMode: draft.touristMode,
                  mustHaveStyles: draft.mustHaveStyles,
                  experiencePrefs: draft.experiencePrefs,
                  motives: draft.motives,
                }),
              ).then(() => {
                void markTravelPrefsReviewed();
                close();
              });
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    zIndex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    flex: 1,
    paddingRight: 8,
  },
  close: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  lead: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  scroll: { flexGrow: 0 },
  scrollBody: { paddingBottom: spacing.md, gap: spacing.sm },
  subHead: {
    marginTop: spacing.md,
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
});
