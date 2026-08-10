/**
 * On-Screen-Demos für die geführte Feature-Tour (wie echte UI).
 * Action-Buttons in der Demo sind tot — außer Skip außerhalb.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import type { ExplanationHint } from '../i18n';
import {
  buildPostTourHelpActions,
  cityDemoPack,
} from '../services/onboarding/guidedFeatureTour';

type Props = {
  hint: ExplanationHint;
  cityName: string;
  landmarkName?: string | null;
  settingsOpen: boolean;
  settingsAccordion: string | null;
  onToggleAccordion: (id: string) => void;
  /** Nach Tour: echte Hilfe-Chips */
  helpInteractive?: boolean;
  onHelpAction?: (prompt: string) => void;
  module1Ref?: React.RefObject<View | null>;
  bulletsRef?: React.RefObject<View | null>;
  actionsRef?: React.RefObject<View | null>;
  settingsDemoRef?: React.RefObject<View | null>;
  queueDemoRef?: React.RefObject<View | null>;
  timelineRef?: React.RefObject<View | null>;
  /** true = echte PlanCalendarModal ist offen — kein Fake-Overlay. */
  realTimelineOpen?: boolean;
};

const SETTINGS_ROWS = [
  {
    id: 'triggers',
    title: 'Meine Trigger',
    body: 'Zeit-, Geo- und Navigations-Erinnerungen aus der Timeline — alles, was dich pünktlich machen soll.',
  },
  {
    id: 'setup',
    title: 'Einrichtung',
    body: 'Stimme, Über dich & Kontakt, Charakter, Interessen, Reise-Präferenzen — alles aus dem Setup nochmal änderbar.',
  },
  {
    id: 'city',
    title: 'Stadt',
    body: 'Stadt wechseln — Erlebnis-Wünsche werden dann neu abgefragt.',
  },
  {
    id: 'saverAudio',
    title: 'Audio & Sparmodus',
    body: 'Mikrofon an/aus (Nur tippen), Stimme+Untertitel / Nur Text / Stumm, Sparmodus für weniger Daten.',
  },
  {
    id: 'explanations',
    title: 'Erklärungen',
    body: 'Funktionen nachlesen, wenn du was vergessen hast.',
  },
  {
    id: 'feedback',
    title: 'Feedback & Probleme',
    body: 'Rückmeldung geben oder Probleme melden.',
  },
];

export function GuidedFeatureTourOverlays({
  hint,
  cityName,
  landmarkName,
  settingsOpen,
  settingsAccordion,
  onToggleAccordion,
  helpInteractive = false,
  onHelpAction,
  module1Ref,
  bulletsRef,
  actionsRef,
  settingsDemoRef,
  queueDemoRef,
  timelineRef,
  realTimelineOpen = false,
}: Props) {
  const pack = cityDemoPack(cityName);
  const landmark = (landmarkName ?? pack.landmark).trim();
  const showModule1 =
    hint === 'module1' || hint === 'bullets' || hint === 'actions';
  const showPassport = hint === 'passport';
  const showSettings = hint === 'settings_panel' || settingsOpen;
  const showQueue = hint === 'nav_queue';
  const showTimeline = hint === 'timeline' && !realTimelineOpen;
  const showHelp = hint === 'help_prompt';
  const helpActions = buildPostTourHelpActions(cityName);

  return (
    <>
      {showPassport ? (
        <View style={styles.passportOverlay} pointerEvents="none" collapsable={false}>
          <View style={styles.passportCard}>
            <Text style={styles.planTitle}>Stempelkarte</Text>
            <Text style={styles.passportHint}>
              Unter dem Zahnrad: Fog-of-War und was du schon erkundet hast.
              Route = Navi & Multi-Stopps.
            </Text>
            <View style={styles.passportStamp}>
              <Text style={styles.passportStampText}>✓ {landmark}</Text>
            </View>
            <View style={styles.passportStamp}>
              <Text style={styles.passportStampText}>✓ {pack.timelineStops[1]}</Text>
            </View>
            <Text style={styles.planHint}>
              Finger zeigt aufs Karten-Icon unter dem Zahnrad.
            </Text>
          </View>
        </View>
      ) : null}

      {showModule1 ? (
        <View
          ref={module1Ref as React.RefObject<View>}
          style={styles.module1Wrap}
          pointerEvents="none"
          collapsable={false}
        >
          <View style={styles.module1Glow}>
            <Text style={styles.module1Badge}>Jetzt vor dir</Text>
            <Text style={styles.module1Title}>{landmark}</Text>
            <Text style={styles.module1Speech}>
              Schau nach vorne. Siehst du das markante Gebäude? Das ist die{' '}
              {landmark} — ich erzähl dir kurz, warum sie hier steht und was heute
              noch davon lebt…
            </Text>

            {(hint === 'bullets' || hint === 'actions') && (
              <View ref={bulletsRef as React.RefObject<View>} collapsable={false}>
                <Text style={styles.bulletsLabel}>Stichpunkte</Text>
                <View style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>Wahrzeichen von {cityName || 'hier'}</Text>
                </View>
                <View style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>Foto-Spot & Treffpunkt</Text>
                </View>
                <View style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>Am besten tagsüber / bei gutem Licht</Text>
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
                  <Text style={styles.actionBtnText}>Mehr Infos</Text>
                </View>
                <View style={styles.actionBtnSecondary}>
                  <Text style={styles.actionBtnTextSecondary}>Speisekarte</Text>
                </View>
              </View>
            ) : null}
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

      {showTimeline ? (
        <View
          ref={timelineRef as React.RefObject<View>}
          style={styles.timelineOverlay}
          pointerEvents="none"
          collapsable={false}
        >
          <View style={styles.timelineCard}>
            <Text style={styles.planTitle}>Timeline - Beispiel</Text>
            <Text style={styles.timelinePast}>
              10:12 - {pack.timelineStops[0]} ✓
            </Text>
            <Text style={styles.timelinePast}>
              11:40 - {pack.timelineStops[1]} ✓
            </Text>
            <View style={styles.blueLine} />
            <Text style={styles.timelinePlan}>
              14:00 - Navi: {pack.timelineStops[2]}
            </Text>
            <Text style={styles.timelinePlan}>
              15:30 - Erinnerung: Zahnbuerste
            </Text>
            <Text style={styles.timelinePlan}>19:45 - Sonnenuntergang</Text>
            <Text style={styles.planHint}>
              Ueber der blauen Linie: wo du warst. Darunter: Planungsmodus.
            </Text>
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
            <Text style={styles.queueItem}>1 · {pack.timelineStops[0]} ▸</Text>
            <Text style={styles.queueItem}>2 · {pack.timelineStops[1]} ↕</Text>
            <Text style={styles.queueItemMuted}>3 · {pack.timelineStops[2]}</Text>
          </View>
        </View>
      ) : null}

      {showHelp ? (
        <View style={styles.helpOverlay} pointerEvents="box-none">
          <View style={styles.helpCard}>
            <Text style={styles.bulletsLabel}>Wo kann ich dir helfen?</Text>
            <View style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>Orte & Highlights</Text>
            </View>
            <View style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>Essen & Unterkunft</Text>
            </View>
            <View style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>Einfach loslaufen</Text>
            </View>
            <View style={styles.actionsRow}>
              {helpActions.map((a) =>
                helpInteractive ? (
                  <Pressable
                    key={a.label}
                    style={styles.actionBtn}
                    onPress={() => onHelpAction?.(a.prompt)}
                  >
                    <Text style={styles.actionBtnText}>{a.label}</Text>
                  </Pressable>
                ) : (
                  <View key={a.label} style={styles.actionBtn}>
                    <Text style={styles.actionBtnText}>{a.label}</Text>
                  </View>
                ),
              )}
            </View>
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
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 8,
  },
  module1Title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  module1Speech: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  bulletsLabel: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    marginTop: 4,
  },
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  bulletDot: { color: colors.accent, fontWeight: '900' },
  bulletText: { color: colors.text, flex: 1, fontSize: 13, lineHeight: 18 },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionBtnText: { color: colors.bg, fontWeight: '800', fontSize: 12 },
  actionBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  actionBtnTextSecondary: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
  },
  settingsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: spacing.lg,
    zIndex: UI_LAYER.overlay,
  },
  settingsCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 18,
    padding: spacing.md,
    maxHeight: '80%',
  },
  settingsTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  accRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  accTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
  accChevron: { color: colors.textMuted },
  accBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 8,
    paddingRight: 8,
  },
  passportOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: 72,
    zIndex: UI_LAYER.overlay,
  },
  passportCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planTitle: { color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: 6 },
  passportHint: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  passportStamp: {
    backgroundColor: 'rgba(61,207,122,0.15)',
    borderRadius: 10,
    padding: 8,
    marginBottom: 6,
  },
  passportStampText: { color: colors.accent, fontWeight: '700' },
  planHint: { color: colors.textMuted, fontSize: 11, marginTop: 6 },
  timelineOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    zIndex: UI_LAYER.overlay,
  },
  timelineCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 18,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timelinePast: { color: colors.textMuted, fontSize: 13, marginBottom: 4 },
  timelinePlan: { color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  blueLine: {
    height: 2,
    backgroundColor: '#4EA1FF',
    marginVertical: 10,
    borderRadius: 2,
  },
  queueOverlay: {
    position: 'absolute',
    right: spacing.md,
    top: 90,
    zIndex: UI_LAYER.overlay,
  },
  queueCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: spacing.md,
    minWidth: 180,
    borderWidth: 1,
    borderColor: colors.border,
  },
  queueTitle: { color: colors.text, fontWeight: '800', marginBottom: 8 },
  queueItem: { color: colors.text, marginBottom: 4, fontSize: 13 },
  queueItemMuted: { color: colors.textMuted, fontSize: 13 },
  helpOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: spacing.md,
    paddingBottom: 120,
    zIndex: UI_LAYER.overlay,
  },
  helpCard: {
    backgroundColor: 'rgba(15, 44, 36, 0.96)',
    borderRadius: 18,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: '#3DCF7A',
  },
});
