/**
 * „Wie soll ich sein?“ — 4 Kategorien, Ausschlüsse, Golden-Match-Rahmen.
 * Kernrollen mit echten Portraits; Info als modernes Sheet.
 */

import React, { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  OnboardingShell,
  PrimaryButton,
  StepSubtitle,
  StepTitle,
} from './OnboardingUI';
import { OnboardingInfoSheet } from './OnboardingInfoSheet';
import { colors, spacing } from '../constants/theme';
import { CORE_ROLE_PORTRAITS } from '../constants/personaPortraits';
import {
  CORE_ROLES,
  VIBE_TONES,
  KNOWLEDGE_STYLES,
  SPLEENS,
  expressGoldenCombos,
  isOptionExcluded,
  matchGoldenCombo,
  type CoreRoleId,
  type VibeToneId,
  type KnowledgeStyleId,
  type SpleenId,
} from '../constants/personalityMatrix';

export type PersonalityMatrixSections = 'all' | 'core' | 'detail';

type Props = {
  coreRole: CoreRoleId | null;
  vibeTone: VibeToneId | null;
  knowledgeStyle: KnowledgeStyleId | null;
  spleens: SpleenId[];
  onChange: (p: {
    coreRole?: CoreRoleId | null;
    vibeTone?: VibeToneId | null;
    knowledgeStyle?: KnowledgeStyleId | null;
    spleens?: SpleenId[];
  }) => void;
  onNext: () => void;
  /** Legacy: optional externer Info-Handler */
  onInfo?: (title: string, body: string) => void;
  hideContinue?: boolean;
  embed?: boolean;
  /** Golden-Match-Banner/Rahmen — nur Express, nicht im Standard-Matrix. */
  showGoldenMatch?: boolean;
  /** Schnellprofile — nur Express. */
  showQuickPresets?: boolean;
  /**
   * Settings: core = nur Kernrolle; detail = Tonalität/Wissen/Spleens;
   * all = alles (Onboarding-Default).
   */
  sections?: PersonalityMatrixSections;
};

export function PersonalityMatrixStep({
  coreRole,
  vibeTone,
  knowledgeStyle,
  spleens,
  onChange,
  onNext,
  onInfo,
  hideContinue,
  embed,
  showGoldenMatch = false,
  showQuickPresets = false,
  sections = 'all',
}: Props) {
  const selected = { coreRole, vibeTone, knowledgeStyle, spleens };
  const golden = showGoldenMatch ? matchGoldenCombo(selected) : null;
  const matchedPreset = matchGoldenCombo(selected);
  const valid = !!coreRole && !!vibeTone && !!knowledgeStyle;
  const quickPresets = showQuickPresets ? expressGoldenCombos() : [];
  const [info, setInfo] = useState<{ title: string; body: string } | null>(
    null,
  );

  const showInfo = (title: string, body: string) => {
    setInfo({ title, body });
    onInfo?.(title, body);
  };

  const pickSpleen = (id: SpleenId) => {
    const ex = isOptionExcluded(id, selected);
    if (ex.excluded) {
      showInfo('Passt nicht', ex.reason ?? '');
      return;
    }
    if (spleens.includes(id)) {
      onChange({ spleens: spleens.filter((s) => s !== id) });
      return;
    }
    if (spleens.length >= 2) return;
    onChange({ spleens: [...spleens, id] });
  };

  const body = (
    <>
      {!embed ? (
        <>
          <StepTitle>Wie soll ich sein?</StepTitle>
          <StepSubtitle>
            Du entscheidest — nichts ist vorausgewählt. Je Kategorie eine Wahl.
            Spleens optional, maximal zwei. Tippe auf (i) für Details.
          </StepSubtitle>
        </>
      ) : null}
      {showGoldenMatch && golden ? (
        <View style={styles.goldenBanner}>
          <Text style={styles.goldenText}>
            Perfektes Match: {golden.labelDe}
          </Text>
        </View>
      ) : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.pad}>
      {sections === 'all' && showQuickPresets && quickPresets.length > 0 ? (
        <Section title="Schnellprofile">
          <Text style={styles.quickHint}>
            Fertige Combos — Tonalität, Wissen und Spleens setze ich passend mit.
          </Text>
          <View style={styles.quickGrid}>
            {quickPresets.map((combo) => {
              const on = matchedPreset?.id === combo.id;
              return (
                <Pressable
                  key={combo.id}
                  onPress={() =>
                    onChange({
                      coreRole: combo.coreRole,
                      vibeTone: combo.vibeTone,
                      knowledgeStyle: combo.knowledgeStyle,
                      spleens: [...combo.spleens],
                    })
                  }
                  style={[styles.quickCard, on && styles.itemSelected]}
                >
                  <Text style={styles.quickEmoji}>{combo.emoji}</Text>
                  <View style={styles.quickTextCol}>
                    <Text style={styles.quickTitle} numberOfLines={2}>
                      {combo.labelDe}
                    </Text>
                    <Text style={styles.quickSub} numberOfLines={1}>
                      {combo.infoDe}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Section>
      ) : null}
        {sections === 'all' || sections === 'core' ? (
        <Section title={sections === 'core' ? 'Kernrolle' : '1 · Kern-Rolle'}>
          <View style={styles.row}>
            {CORE_ROLES.map((o) => {
              const blocked = isOptionExcluded(o.id, {
                vibeTone,
                knowledgeStyle,
                spleens,
              });
              return (
                <RoleCard
                  key={o.id}
                  roleId={o.id}
                  label={o.labelDe}
                  info={o.infoDe}
                  selected={coreRole === o.id}
                  disabled={blocked.excluded && coreRole !== o.id}
                  golden={golden?.coreRole === o.id}
                  onPress={() => {
                    if (blocked.excluded && coreRole !== o.id) {
                      showInfo('Passt nicht', blocked.reason ?? '');
                      return;
                    }
                    onChange({ coreRole: o.id });
                  }}
                  onInfo={() => showInfo(o.labelDe, o.infoDe)}
                />
              );
            })}
          </View>
        </Section>
        ) : null}
        {sections === 'all' || sections === 'detail' ? (
        <>
        <Section
          title={
            sections === 'detail'
              ? 'Tonalität & Stimmung'
              : '2 · Tonalität & Stimmung'
          }
        >
          <View style={styles.stack}>
            {VIBE_TONES.map((o) => {
              const blocked = isOptionExcluded(o.id, {
                coreRole,
                knowledgeStyle,
                spleens,
              });
              return (
                <OptionChip
                  key={o.id}
                  emoji={o.emoji}
                  label={o.labelDe}
                  selected={vibeTone === o.id}
                  disabled={blocked.excluded && vibeTone !== o.id}
                  golden={golden?.vibeTone === o.id}
                  onPress={() => {
                    if (blocked.excluded && vibeTone !== o.id) {
                      showInfo('Passt nicht', blocked.reason ?? '');
                      return;
                    }
                    onChange({ vibeTone: o.id });
                  }}
                  onInfo={() => showInfo(o.labelDe, o.infoDe)}
                />
              );
            })}
          </View>
        </Section>
        <Section
          title={
            sections === 'detail' ? 'Wissensvermittlung' : '3 · Wissensvermittlung'
          }
        >
          <View style={styles.stack}>
            {KNOWLEDGE_STYLES.map((o) => {
              const blocked = isOptionExcluded(o.id, {
                coreRole,
                vibeTone,
                spleens,
              });
              return (
                <OptionChip
                  key={o.id}
                  emoji={o.emoji}
                  label={o.labelDe}
                  selected={knowledgeStyle === o.id}
                  disabled={blocked.excluded && knowledgeStyle !== o.id}
                  golden={golden?.knowledgeStyle === o.id}
                  onPress={() => {
                    if (blocked.excluded && knowledgeStyle !== o.id) {
                      showInfo('Passt nicht', blocked.reason ?? '');
                      return;
                    }
                    onChange({ knowledgeStyle: o.id });
                  }}
                  onInfo={() => showInfo(o.labelDe, o.infoDe)}
                />
              );
            })}
          </View>
        </Section>
        <Section
          title={
            sections === 'detail'
              ? 'Spleens (max. 2, optional)'
              : '4 · Spleens (max. 2, optional)'
          }
        >
          <View style={styles.stack}>
            {SPLEENS.map((o) => {
              const blocked = isOptionExcluded(o.id, selected);
              const sel = spleens.includes(o.id);
              return (
                <OptionChip
                  key={o.id}
                  emoji={o.emoji}
                  label={o.labelDe}
                  selected={sel}
                  disabled={
                    (blocked.excluded && !sel) || (!sel && spleens.length >= 2)
                  }
                  golden={golden?.spleens.includes(o.id)}
                  onPress={() => pickSpleen(o.id)}
                  onInfo={() => showInfo(o.labelDe, o.infoDe)}
                />
              );
            })}
          </View>
        </Section>
        </>
        ) : null}
      </ScrollView>
      {!hideContinue ? (
        <PrimaryButton
          label="Weiter zur Stimme"
          onPress={onNext}
          disabled={!valid}
        />
      ) : null}
      <OnboardingInfoSheet
        visible={!!info}
        title={info?.title ?? ''}
        body={info?.body ?? ''}
        onClose={() => setInfo(null)}
      />
    </>
  );

  if (embed) {
    return <View style={{ flex: 1 }}>{body}</View>;
  }
  return <OnboardingShell>{body}</OnboardingShell>;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function RoleCard({
  roleId,
  label,
  selected,
  disabled,
  golden,
  onPress,
  onInfo,
}: {
  roleId: CoreRoleId;
  label: string;
  info: string;
  selected: boolean;
  disabled?: boolean;
  golden?: boolean;
  onPress: () => void;
  onInfo: () => void;
}) {
  return (
    <View
      style={[
        styles.roleWrap,
        selected && styles.itemSelected,
        golden && styles.itemGolden,
        disabled && styles.itemDisabled,
      ]}
    >
      <Pressable style={styles.roleMain} onPress={onPress} disabled={disabled}>
        <View style={styles.roleImageFrame}>
          <Image
            source={CORE_ROLE_PORTRAITS[roleId]}
            style={styles.roleImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        </View>
        <Text style={styles.roleLabel}>{label}</Text>
      </Pressable>
      <Pressable onPress={onInfo} hitSlop={8} style={styles.infoBtn}>
        <Text style={styles.infoTxt}>i</Text>
      </Pressable>
    </View>
  );
}

function OptionChip({
  emoji,
  label,
  selected,
  disabled,
  golden,
  onPress,
  onInfo,
}: {
  emoji: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  golden?: boolean;
  onPress: () => void;
  onInfo: () => void;
}) {
  return (
    <View
      style={[
        styles.chipWrap,
        selected && styles.itemSelected,
        golden && styles.itemGolden,
        disabled && styles.itemDisabled,
      ]}
    >
      <Pressable style={styles.chipMain} onPress={onPress} disabled={disabled}>
        <Text style={styles.chipEmoji}>{emoji}</Text>
        <Text style={styles.chipLabel}>{label}</Text>
      </Pressable>
      <Pressable onPress={onInfo} hitSlop={8} style={styles.chipInfoBtn}>
        <Text style={styles.infoTxt}>i</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  pad: { paddingBottom: spacing.xl, gap: spacing.lg },
  goldenBanner: {
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 12,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.accentSoft,
  },
  goldenText: { color: colors.accent, fontWeight: '700', textAlign: 'center' },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 4,
  },
  quickHint: {
    width: '100%',
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    marginBottom: 2,
  },
  stack: {
    width: '100%',
    gap: spacing.sm,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickCard: {
    width: '48%',
    flexGrow: 1,
    maxWidth: '48%',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 8,
    minHeight: 48,
  },
  quickEmoji: { fontSize: 16, flexShrink: 0 },
  quickTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  quickTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  quickSub: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  roleWrap: {
    width: '47%',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    position: 'relative',
    overflow: 'hidden',
  },
  roleMain: { gap: 0, paddingBottom: spacing.sm },
  /** Assets sind 1:1 — Frame exakt quadratisch, kein Letterbox. */
  roleImageFrame: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  roleImage: {
    width: '100%',
    height: '100%',
  },
  roleLabel: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: spacing.sm,
  },
  chipWrap: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 6,
  },
  itemSelected: { borderColor: colors.accent },
  itemGolden: { borderColor: '#E8C547', borderWidth: 2 },
  itemDisabled: { opacity: 0.35 },
  chipMain: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chipEmoji: { fontSize: 18, flexShrink: 0 },
  chipLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  infoBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26, 31, 40, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(196, 163, 90, 0.45)',
    zIndex: 2,
  },
  chipInfoBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
    flexShrink: 0,
    backgroundColor: colors.accentSoft,
  },
  infoTxt: { color: colors.accent, fontWeight: '800', fontSize: 12 },
});
