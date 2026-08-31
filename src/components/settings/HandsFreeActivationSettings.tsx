/**
 * Hands-free & Live-Chat — alle Einstellungen.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';
import {
  getHandsFreePrefsSync,
  loadHandsFreePrefs,
  patchHandsFreePrefs,
  type HandsFreePrefs,
  type HeadsetButtonMode,
  type LiveChatIdleSeconds,
} from '../../services/handsFree/handsFreePrefs';
import { syncHandsFreeListenNotification } from '../../services/handsFree/handsFreeNotification';
import { openDigitalAssistantSettings } from '../../services/handsFree/handsFreeLinking';
import { playLiveChatStartCue, playMicStartCue } from '../../services/handsFree/micStartCue';
import { requestHandsFreeListen } from '../../services/handsFree/handsFreeBus';
import {
  startLiveChatSession,
  stopLiveChatSession,
  subscribeLiveChat,
} from '../../services/handsFree/liveChatSession';
import { syncHeadsetButtonControls } from '../../services/handsFree/headsetButtonService';

const IDLE_OPTS: LiveChatIdleSeconds[] = [15, 30, 45, 60];

const HEADSET_OPTS: { id: HeadsetButtonMode; label: string }[] = [
  { id: 'off', label: 'Aus' },
  { id: 'once', label: 'Mikro an' },
  { id: 'livechat', label: 'Live-Chat' },
];

export function HandsFreeActivationSettings() {
  const [prefs, setPrefs] = useState<HandsFreePrefs>(getHandsFreePrefsSync());
  const [liveOn, setLiveOn] = useState(false);

  useEffect(() => {
    void loadHandsFreePrefs().then(setPrefs);
  }, []);

  useEffect(() => subscribeLiveChat((on) => setLiveOn(on)), []);

  const update = useCallback(async (patch: Partial<HandsFreePrefs>) => {
    const next = await patchHandsFreePrefs(patch);
    setPrefs(next);
    await syncHandsFreeListenNotification();
    if (patch.headsetButtonMode !== undefined) {
      await syncHeadsetButtonControls();
    }
  }, []);

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>
        Hands-free und Live-Chat — per Notification, Mic-Wisch oder In-Ear-Taste.
      </Text>

      <Text style={styles.section}>Aktivierung</Text>

      <Row
        title="„Sprechen“-Notification"
        hint="Nur wenn GPS nicht schon eine Yorro-Karte in der Leiste hat. Tippen startet das Mikro."
        value={prefs.stickyListenNotification}
        onChange={(stickyListenNotification) =>
          void update({ stickyListenNotification })
        }
      />
      <Row
        title="Mikrofon-Signalton"
        hint="Piep + Vibration beim Start."
        value={prefs.micStartCue}
        onChange={(micStartCue) => void update({ micStartCue })}
      />
      <Row
        title="Live-Chat nach „Sprechen“"
        hint="Statt Einmal-Aufnahme: Mikro bleibt an. Am Mic: links wischen = Live-Chat, rechts = fixieren."
        value={prefs.liveChatOnHandsFree}
        onChange={(liveChatOnHandsFree) =>
          void update({ liveChatOnHandsFree })
        }
      />

      <Text style={[styles.rowTitle, { marginTop: spacing.sm }]}>
        In-Ear-Taste
      </Text>
      <Text style={styles.hint}>
        Play/Pause bzw. Hook — Aus, Mikro an, oder Live-Chat. Greift, wenn
        Yorro die Media-Session hält (nicht während Spotify o. Ä.).
      </Text>
      <View style={styles.chipRow}>
        {HEADSET_OPTS.map(({ id, label }) => {
          const on = prefs.headsetButtonMode === id;
          return (
            <Pressable
              key={id}
              onPress={() => void update({ headsetButtonMode: id })}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.section}>Live-Chat Verhalten</Text>

      <Text style={styles.rowTitle}>Idle bis Mikro aus</Text>
      <Text style={styles.hint}>
        Ohne an dich gerichtete Äußerung — danach aus.
      </Text>
      <View style={styles.chipRow}>
        {IDLE_OPTS.map((sec) => {
          const on = prefs.liveChatIdleSeconds === sec;
          return (
            <Pressable
              key={sec}
              onPress={() => void update({ liveChatIdleSeconds: sec })}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {sec}s
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Row
        title="Strenger Adress-Filter"
        hint="Aus (empfohlen): nach Start/Antwort frei weiterreden — „führ mich dahin“. An: nur klarere Yorro-Fragen."
        value={prefs.requireKeywordEveryTurn}
        onChange={(requireKeywordEveryTurn) =>
          void update({ requireKeywordEveryTurn })
        }
      />
      <Row
        title="Menschlich & kurz reden"
        hint="Wie ein Gespräch — keine Brief-Antworten, Fast-Lane online."
        value={prefs.humanConversationTone}
        onChange={(humanConversationTone) =>
          void update({ humanConversationTone })
        }
      />
      <Text style={[styles.hint, { marginBottom: spacing.sm }]}>
        Live-Chat: Deep Research erst nachfragen (Fast-Lane zuerst). Außerhalb
        Live-Chat: Recherche immer automatisch.
      </Text>

      <Pressable
        style={styles.btn}
        onPress={() => {
          void (async () => {
            if (liveOn) {
              await stopLiveChatSession('settings');
              return;
            }
            void playLiveChatStartCue({ force: true });
            const r = await startLiveChatSession('settings');
            if (!r.ok) requestHandsFreeListen('settings_test');
          })();
        }}
      >
        <Text style={styles.btnText}>
          {liveOn ? 'Live-Chat stoppen' : 'Live-Chat starten'}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.btn, styles.btnSecondary]}
        onPress={() => {
          void playMicStartCue({ force: true });
          requestHandsFreeListen('settings_test');
        }}
      >
        <Text style={styles.btnTextSecondary}>Einmal-Mikro testen</Text>
      </Pressable>

      <Pressable
        style={[styles.btn, styles.btnSecondary]}
        onPress={() => {
          void playLiveChatStartCue({ force: true });
        }}
      >
        <Text style={styles.btnTextSecondary}>Live-Chat-Ton anhören</Text>
      </Pressable>

      <Text style={[styles.hint, { marginTop: spacing.md }]}>
        Launcher: Icon lange drücken → „Sprechen“. Power/Gemini ersetzt Yorro
        nicht — Assistenten-Einstellungen öffnen.
      </Text>

      <Pressable
        style={[styles.btn, styles.btnSecondary]}
        onPress={() => void openDigitalAssistantSettings()}
      >
        <Text style={styles.btnTextSecondary}>
          Assistenten-Einstellungen öffnen
        </Text>
      </Pressable>
    </View>
  );
}

function Row({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#444', true: colors.accent }}
        thumbColor={colors.text}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  section: {
    marginTop: spacing.md,
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipText: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 13,
  },
  chipTextOn: { color: colors.accent },
  btn: {
    marginTop: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  btnText: {
    color: colors.bg,
    fontWeight: '800',
    fontSize: 14,
  },
  btnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnTextSecondary: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
});
