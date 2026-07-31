/**
 * On-Screen-Demos für die geführte Feature-Tour (wie echte UI).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import type { ExplanationHint } from '../i18n';

type Props = {
  hint: ExplanationHint;
  cityName: string;
  settingsOpen: boolean;
  settingsAccordion: string | null;
  onToggleAccordion: (id: string) => void;
  planningRef?: React.RefObject<View | null>;
  module1Ref?: React.RefObject<View | null>;
  bulletsRef?: React.RefObject<View | null>;
  actionsRef?: React.RefObject<View | null>;
  planDemoRef?: React.RefObject<View | null>;
  settingsDemoRef?: React.RefObject<View | null>;
  queueDemoRef?: React.RefObject<View | null>;
};

const SETTINGS_ROWS = [
  { id: 'setup', title: 'Einrichtung', body: 'Stadt, Stimme, Charakter, Interessen.' },
  { id: 'about', title: 'Über dich', body: 'Name, Reiseziel, was du erleben willst.' },
  { id: 'voice', title: 'Stimme & Charakter', body: 'Welche Stimme und welcher Ton zu dir passen.' },
  { id: 'power', title: 'Sparmodus', body: 'Weniger Hintergrund-Calls, längerer Akku.' },
  { id: 'mute', title: 'Stummmodus', body: 'Museum / Indoor — Findus schweigt und wacht später auf.' },
  { id: 'help', title: 'Erklärungen', body: 'Immer aktuell: alle Funktionen nachlesen.' },
  { id: 'feedback', title: 'Feedback & Probleme', body: 'Hilft dir — und allen anderen Findus-Nutzern.' },
];

export function GuidedFeatureTourOverlays({
  hint,
  cityName,
  settingsOpen,
  settingsAccordion,
  onToggleAccordion,
  module1Ref,
  bulletsRef,
  actionsRef,
  planDemoRef,
  settingsDemoRef,
  queueDemoRef,
}: Props) {
  const showModule1 =
    hint === 'module1' || hint === 'bullets' || hint === 'actions';
  const showPlanning = hint === 'planning';
  const showSettings = hint === 'settings' || settingsOpen;
  const showQueue = hint === 'nav_queue';

  return (
    <>
      {showModule1 ? (
        <View
          ref={module1Ref as React.RefObject<View>}
          style={styles.module1Wrap}
          pointerEvents="none"
          collapsable={false}
        >
          <View style={styles.module1Glow}>
            <Text style={styles.module1Badge}>Jetzt vor dir</Text>
            <Text style={styles.module1Title}>
              Wahrzeichen · {cityName || 'dein Ort'}
            </Text>
            <Text style={styles.module1Speech}>
              Siehst du das markante Gebäude da vorne? Das ist das Wahrzeichen
              des Ortes — ich erzähl dir kurz, warum es hier steht und was heute
              noch davon lebt…
            </Text>

            {(hint === 'bullets' || hint === 'actions') && (
              <View ref={bulletsRef as React.RefObject<View>} collapsable={false}>
                <Text style={styles.bulletsLabel}>Stichpunkte</Text>
                <View style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>Erbaut als Orientierungspunkt</Text>
                </View>
                <View style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>Heute Treffpunkt & Foto-Spot</Text>
                </View>
                <View style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>Freier Zugang, tagsüber am schönsten</Text>
                </View>
              </View>
            )}

            {hint === 'actions' ? (
              <View
                ref={actionsRef as React.RefObject<View>}
                style={styles.actionsRow}
                collapsable={false}
              >
                <View style={styles.actionBtn}>
                  <Text style={styles.actionBtnText}>Route hierhin</Text>
                </View>
                <View style={styles.actionBtn}>
                  <Text style={styles.actionBtnText}>Mehr Geschichte</Text>
                </View>
                <View style={styles.actionBtnSecondary}>
                  <Text style={styles.actionBtnTextSecondary}>Weiterlaufen</Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {showPlanning ? (
        <View
          ref={planDemoRef as React.RefObject<View>}
          style={styles.planOverlay}
          pointerEvents="none"
          collapsable={false}
        >
          <View style={styles.planCard}>
            <Text style={styles.planTitle}>Tagesplan · Timeline</Text>
            <View style={styles.planItemPast}>
              <Text style={styles.planTime}>09:40</Text>
              <Text style={styles.planText}>Bahnhof — wirklich da gewesen</Text>
            </View>
            <View style={styles.planItemPast}>
              <Text style={styles.planTime}>10:15</Text>
              <Text style={styles.planText}>Café am Markt — Stempel</Text>
            </View>
            <View style={styles.planNow}>
              <Text style={styles.planNowText}>—— Jetzt ——</Text>
            </View>
            <View style={styles.planItemFuture}>
              <Text style={styles.planTime}>12:30</Text>
              <Text style={styles.planText}>Mittagessen (Plan)</Text>
            </View>
            <View style={styles.planItemFuture}>
              <Text style={styles.planTime}>16:00</Text>
              <Text style={styles.planText}>Aussicht / Sonnenuntergang</Text>
            </View>
            <Text style={styles.planHint}>
              Vergangenheit = Zeitachse · Zukunft = gemeinsamer Plan
            </Text>
          </View>
        </View>
      ) : null}

      {showSettings ? (
        <View style={styles.settingsOverlay} pointerEvents="box-none">
          <View
            ref={settingsDemoRef as React.RefObject<View>}
            style={styles.settingsCard}
            collapsable={false}
          >
            <Text style={styles.settingsTitle}>Einstellungen</Text>
            {SETTINGS_ROWS.map((row) => {
              const open = settingsAccordion === row.id;
              return (
                <View key={row.id}>
                  <Pressable
                    style={styles.accRow}
                    onPress={() => onToggleAccordion(row.id)}
                  >
                    <Text style={styles.accTitle}>{row.title}</Text>
                    <Text style={styles.accChevron}>{open ? '▾' : '▸'}</Text>
                  </Pressable>
                  {open ? (
                    <Text style={styles.accBody}>{row.body}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {showQueue ? (
        <View
          ref={queueDemoRef as React.RefObject<View>}
          style={styles.queueOverlay}
          pointerEvents="none"
          collapsable={false}
        >
          <View style={styles.queueCard}>
            <Text style={styles.queueTitle}>Navigation · Stopps</Text>
            <Text style={styles.queueItem}>1 · Rathaus ▸</Text>
            <Text style={styles.queueItem}>2 · Hafen ↕ verschieben</Text>
            <Text style={styles.queueItemMuted}>3 · Hotel ✕ löschen</Text>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  module1Wrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    zIndex: UI_LAYER.overlay,
  },
  module1Glow: {
    borderRadius: 20,
    padding: spacing.md,
    backgroundColor: 'rgba(15, 44, 36, 0.96)',
    borderWidth: 2,
    borderColor: '#3DCF7A',
    shadowColor: '#3DCF7A',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  module1Badge: {
    alignSelf: 'flex-start',
    color: '#0F2C24',
    backgroundColor: '#3DCF7A',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  module1Title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  module1Speech: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  bulletsLabel: {
    color: '#C4A35A',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  bulletDot: { color: '#3DCF7A', fontWeight: '900' },
  bulletText: { color: colors.text, flex: 1, fontSize: 14, lineHeight: 19 },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
  },
  actionBtn: {
    backgroundColor: '#3DCF7A',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  actionBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  actionBtnText: { fontWeight: '700', fontSize: 13, color: '#0F2C24' },
  actionBtnTextSecondary: { fontWeight: '700', fontSize: 13, color: colors.text },

  planOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    zIndex: UI_LAYER.overlay,
    backgroundColor: 'rgba(8,18,14,0.45)',
  },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planTitle: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  planItemPast: {
    flexDirection: 'row',
    gap: 10,
    opacity: 0.75,
    marginBottom: 6,
  },
  planItemFuture: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  planTime: { color: '#C4A35A', fontWeight: '700', width: 48 },
  planText: { color: colors.text, flex: 1 },
  planNow: {
    alignItems: 'center',
    marginVertical: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#3DCF7A',
  },
  planNowText: { color: '#3DCF7A', fontWeight: '800', letterSpacing: 1 },
  planHint: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },

  settingsOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(8,18,14,0.55)',
    zIndex: UI_LAYER.overlay,
    padding: spacing.md,
  },
  settingsCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: spacing.md,
    maxHeight: '72%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsTitle: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 17,
    marginBottom: spacing.sm,
  },
  accRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  accTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  accChevron: { color: colors.textMuted, fontSize: 16 },
  accBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    paddingBottom: 10,
    paddingTop: 4,
  },

  queueOverlay: {
    position: 'absolute',
    right: spacing.md,
    top: '28%',
    zIndex: UI_LAYER.overlay,
  },
  queueCard: {
    width: 200,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  queueTitle: { color: colors.text, fontWeight: '800', marginBottom: 8 },
  queueItem: { color: colors.text, marginBottom: 6, fontSize: 13 },
  queueItemMuted: { color: colors.textMuted, fontSize: 13 },
});
