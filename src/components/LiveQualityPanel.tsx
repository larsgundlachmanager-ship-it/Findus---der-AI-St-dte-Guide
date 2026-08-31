/**
 * Developer: Live-Qualität — Playbook + Routing-Check für echte Fragen.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { colors, spacing } from '../constants/theme';
import {
  getLiveQualitySuite,
  runLiveQualityHarness,
  type LiveQualityReport,
  type LiveQualityScenario,
} from '../module2/jobs/liveQualityHarness';
import { getInteractionDelaySnapshot } from '../services/diagnostics/interactionDelay';

export function LiveQualityPanel() {
  const suite = useMemo(() => getLiveQualitySuite(), []);
  const must = useMemo(
    () => suite.scenarios.filter((s) => s.tier === 'device_must'),
    [suite.scenarios],
  );
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState<LiveQualityReport | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [delayTick, setDelayTick] = useState(0);
  const delay = useMemo(
    () => getInteractionDelaySnapshot(),
    [delayTick],
  );

  const onRunRouting = useCallback(() => {
    setReport(runLiveQualityHarness({ tier: 'all' }));
  }, []);

  const toggle = (id: string) => {
    setChecked((c) => ({ ...c, [id]: !c[id] }));
  };

  const doneMust = must.filter((s) => checked[s.id]).length;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{suite.title}</Text>
      {suite.gpsHint ? <Text style={styles.hint}>{suite.gpsHint}</Text> : null}
      <Pressable onPress={() => setDelayTick((n) => n + 1)}>
        <Text style={styles.hint}>
          Tap→Frame p95:{' '}
          {delay.p95Ms != null
            ? `${Math.round(delay.p95Ms)} ms`
            : 'noch keine Samples'}
          {'  '}
          {'(>16 ms = Ruckler, nichts geht kaputt)'}
        </Text>
      </Pressable>

      <Text style={styles.section}>Playbook (Gerät)</Text>
      {suite.devicePlaybook.map((line, i) => (
        <Text key={i} style={styles.play}>
          {i + 1}. {line}
        </Text>
      ))}

      <Pressable
        onPress={onRunRouting}
        style={styles.btn}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>Routing-Check jetzt laufen</Text>
      </Pressable>

      {report ? (
        <View style={styles.reportBox}>
          <Text style={styles.reportTitle}>
            {report.gateOk ? '✓ Gate PASS' : '✗ Gate FAIL'} · {report.passed}/
            {report.total} ({Math.round(report.ratio * 100)}%)
          </Text>
          <Text style={styles.hint}>
            device_must Routing: {report.mustPassed}/{report.mustTotal}
          </Text>
          {report.scenarios
            .filter((s) => !s.ok)
            .slice(0, 6)
            .map((s) => (
              <Text key={s.id} style={styles.failLine}>
                ✗ {s.id}: {s.gotJob} ≠ {s.expectJob}
              </Text>
            ))}
        </View>
      ) : null}

      <Text style={styles.section}>
        Device-Must Fragen ({doneMust}/{must.length} abgehakt)
      </Text>
      <Text style={styles.hint}>
        Tippen zeigt die Frage groß — in der App stellen, dann abhaken.
      </Text>

      <ScrollView style={styles.list} nestedScrollEnabled>
        {must.map((s) => {
          const on = Boolean(checked[s.id]);
          const open = expandedId === s.id;
          return (
            <ScenarioCard
              key={s.id}
              scenario={s}
              done={on}
              open={open}
              onToggleOpen={() =>
                setExpandedId((cur) => (cur === s.id ? null : s.id))
              }
              onToggleDone={() => toggle(s.id)}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

function ScenarioCard({
  scenario: s,
  done,
  open,
  onToggleOpen,
  onToggleDone,
}: {
  scenario: LiveQualityScenario;
  done: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onToggleDone: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable onPress={onToggleOpen} accessibilityRole="button">
        <Text style={open ? styles.qOpen : styles.q}>{s.question}</Text>
        <Text style={styles.meta}>Job: {s.expectJob}</Text>
        {open
          ? (s.deviceChecks ?? []).map((c, i) => (
              <Text key={i} style={styles.check}>
                · {c}
              </Text>
            ))
          : null}
      </Pressable>
      <Pressable
        onPress={onToggleDone}
        style={[styles.checkBtn, done && styles.checkBtnOn]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
      >
        <Text style={[styles.checkBtnText, done && styles.checkBtnTextOn]}>
          {done ? '✓ erledigt' : 'offen'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  title: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.xs,
  },
  section: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
    marginTop: spacing.sm,
  },
  play: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginLeft: spacing.xs,
  },
  btn: {
    marginTop: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 13,
  },
  reportBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 4,
  },
  reportTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  failLine: {
    color: colors.danger,
    fontSize: 12,
  },
  list: { maxHeight: 360, marginTop: spacing.xs },
  card: {
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 6,
  },
  q: { color: colors.text, fontSize: 13, lineHeight: 18 },
  qOpen: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  meta: { color: colors.textMuted, fontSize: 12 },
  check: {
    color: colors.textMuted,
    fontSize: 12,
    marginLeft: 4,
  },
  checkBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  checkBtnOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkBtnText: { color: colors.text, fontSize: 12 },
  checkBtnTextOn: { color: colors.bg, fontWeight: '700' },
});
