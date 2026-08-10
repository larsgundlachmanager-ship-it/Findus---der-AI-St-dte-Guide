/**
 * Settings → Interne Einstellungen: Gelerntes Profil, Logistik, Push-Trigger.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';
import type { UserProfile } from '../../types/userProfile';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';
import { useShoppingTaskStore } from '../../store/useShoppingTaskStore';
import {
  useLogisticsTriggerStore,
  type LogisticsEvent,
  type LogisticsTrigger,
} from '../../store/useLogisticsTriggerStore';
import { useOpenQuestionStore } from '../../store/useOpenQuestionStore';
import { getActiveCatchMyBusReminder } from '../../services/transit/catchMyBusReminder';
import { getPendingWakeProposal } from '../../services/alarms/wakeAlarmAdvisor';
import {
  formatClockMs,
  describeLeavePlan,
  computeLeavePlan,
} from '../../services/logistics/logisticsTriggerMath';
import { formatTriggerStatusLine } from '../../services/logistics/logisticsTriggerEngine';
import {
  getScheduledReminderIds,
  cancelAllFindusReminders,
} from '../../services/notifications/notificationService';
import { getMuteSession, describeMuteSession } from '../../services/audio/muteSessionService';
import { useFuturePlanStore } from '../../module2/timeline/futurePlanState';
import { getActiveTimer } from '../../services/alarms/timerService';

export function BetaSituationsPanel() {
  const [pending, setPending] = useState(0);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { listPendingBetaSituationEvents, getActiveSituationBlueprintsCached } =
        await import('../../services/memory/betaSituationQueue');
      const p = await listPendingBetaSituationEvents();
      const a = await getActiveSituationBlueprintsCached(true);
      setPending(p.length);
      setActive(a.length);
    } catch {
      setPending(0);
      setActive(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const forceSync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { runBetaSituationEveningSync } = await import(
        '../../services/memory/betaSituationSync'
      );
      const r = await runBetaSituationEveningSync({ force: true });
      setMsg(
        r.ok
          ? `Upload ${r.uploaded} · Download ${r.downloaded} Blaupausen`
          : 'Sync fehlgeschlagen (Netz/Credentials?)',
      );
      await refresh();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Beta-Situationen (Crowd → Product)">
      <SectionHint>
        Korrekturen landen lokal in einer Queue, nachts (~02 Uhr) Upload.
        Ab 3 verschiedenen Usern Auto-Blaupause. Review: npm run
        beta:situations:review
      </SectionHint>
      <Bullet>Lokal wartend: {pending}</Bullet>
      <Bullet>Aktive Product-Blaupausen: {active}</Bullet>
      <Pressable
        style={styles.actionBtn}
        onPress={() => void forceSync()}
        disabled={busy}
      >
        <Text style={styles.actionText}>
          {busy ? 'Sync…' : 'Jetzt syncen (Upload + Pack)'}
        </Text>
      </Pressable>
      {msg ? <Text style={styles.hint}>{msg}</Text> : null}
    </Card>
  );
}

function SectionHint({ children }: { children: React.ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

function EmptyLine({ text }: { text: string }) {
  return <Text style={styles.hint}>{text}</Text>;
}

function Bullet({ children }: { children: React.ReactNode }) {
  return <Text style={styles.bullet}>• {children}</Text>;
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function LearnedProfilePanel({
  draft,
  onChange,
  persistPatch,
}: {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  persistPatch: (p: Partial<UserProfile>) => void;
}) {
  const entities = useUserMemoryStore((s) => s.entities);
  const facts = draft.learnedFacts ?? [];
  const diet = draft.personaEngine?.preferences?.dietaryRestrictions ?? [];
  const dislikes = draft.personaEngine?.preferences?.dislikes ?? [];
  const allergies = draft.personaEngine?.preferences?.allergies ?? [];
  const prefs = draft.personaEngine?.preferences;
  const openFacts = useOpenQuestionStore((s) => s.userFacts);
  const itinerary = useUserMemoryStore((s) => s.travelItinerary);

  const clearLearned = () => {
    const next = {
      learnedFacts: [] as string[],
      personaEngine: {
        ...(draft.personaEngine ?? {}),
        preferences: {
          ...(draft.personaEngine?.preferences ?? {}),
          dietaryRestrictions: [],
          dislikes: [],
          allergies: [],
        },
      },
    };
    onChange(next);
    persistPatch(next);
  };

  const confirmed = entities.filter((e) => e.isConfirmed);
  const interestHints: string[] = [];
  if (prefs?.likesMuseums) interestHints.push('Mag Museen');
  if (prefs?.likesChurches) interestHints.push('Mag Kirchen');
  if (prefs?.likesFamousPeople) interestHints.push('Mag bekannte Personen');
  if (prefs?.nightlifeAndEvents) interestHints.push('Nachtleben & Events');
  if (prefs?.wantsDatesAndHistory) interestHints.push('Will Daten & Geschichte');

  const hasAnything =
    facts.length > 0 ||
    diet.length > 0 ||
    dislikes.length > 0 ||
    allergies.length > 0 ||
    interestHints.length > 0 ||
    confirmed.length > 0 ||
    openFacts.length > 0 ||
    Boolean(itinerary?.summary || itinerary?.rawText);

  return (
    <View style={styles.stack}>
      <SectionHint>
        Alles, was Findus über dich lernt — Charakter-Hinweise, Interessen,
        Ernährung, Orte. Einrichtung bleibt für bewusste Einstellungen; hier
        siehst du das gelernte Gedächtnis.
      </SectionHint>

      {!hasAnything ? (
        <EmptyLine text="Noch nichts gelernt — einfach während der Tour sagen." />
      ) : (
        <>
          {(facts.length > 0 ||
            diet.length > 0 ||
            dislikes.length > 0 ||
            allergies.length > 0 ||
            interestHints.length > 0) && (
            <Card title="Aus Gesprächen">
              {facts.map((f) => (
                <Bullet key={f}>{f}</Bullet>
              ))}
              {interestHints.map((d) => (
                <Bullet key={`hint-${d}`}>{d}</Bullet>
              ))}
              {diet.map((d) => (
                <Bullet key={`d-${d}`}>Ernährung: {d}</Bullet>
              ))}
              {allergies.map((d) => (
                <Bullet key={`a-${d}`}>Allergie: {d}</Bullet>
              ))}
              {dislikes.map((d) => (
                <Bullet key={`x-${d}`}>Meidet: {d}</Bullet>
              ))}
            </Card>
          )}

          {openFacts.length > 0 && (
            <Card title="Turn-Fakten">
              {openFacts.slice(-12).map((f) => (
                <Bullet key={`${f.key}-${f.atMs}`}>
                  {f.key}: {f.value}
                </Bullet>
              ))}
            </Card>
          )}

          {confirmed.length > 0 && (
            <Card title="Merke-Orte">
              {confirmed.map((e) => (
                <Bullet key={e.id}>
                  {e.type}: {e.name}
                  {e.notes ? ` — ${e.notes}` : ''}
                </Bullet>
              ))}
            </Card>
          )}

          {(itinerary?.summary || itinerary?.rawText) && (
            <Card title="Reiseplan (Text)">
              <Text style={styles.bodyText}>
                {itinerary?.summary || itinerary?.rawText}
              </Text>
            </Card>
          )}

          <Pressable onPress={clearLearned} style={styles.actionBtn}>
            <Text style={styles.actionText}>Gelerntes Profil löschen</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function kindLabel(kind: LogisticsEvent['kind']): string {
  switch (kind) {
    case 'flight':
      return 'Flug';
    case 'train':
      return 'Zug';
    case 'bus':
      return 'Bus';
    case 'todo':
      return 'To-do';
    case 'reminder':
      return 'Erinnerung';
    case 'alarm':
      return 'Wecker';
    case 'geo':
      return 'Ort';
    case 'session':
      return 'Tagesplan';
    default:
      return kind;
  }
}

export function LogisticsPanel() {
  // Stable selectors — NEVER select getActiveEvents() directly (new array → infinite re-render)
  const allEvents = useLogisticsTriggerStore((s) => s.events);
  const events = useMemo(
    () => allEvents.filter((e) => e.status === 'active'),
    [allEvents],
  );
  const plan = useSessionPlanStore((s) => s.plan);
  const allTasks = useShoppingTaskStore((s) => s.tasks);
  const tasks = useMemo(
    () =>
      allTasks.filter((t) => {
        if (t.status !== 'open') return false;
        if (t.snoozeUntilMs != null && t.snoozeUntilMs > Date.now()) return false;
        return true;
      }),
    [allTasks],
  );
  const entities = useUserMemoryStore((s) => s.entities);
  const bus = getActiveCatchMyBusReminder();
  const wake = getPendingWakeProposal();
  const cancelEvent = useLogisticsTriggerStore((s) => s.cancelEvent);
  const muteLine = describeMuteSession(getMuteSession());

  const transitEntities = entities.filter(
    (e) => e.type === 'transit' || e.type === 'hotel',
  );

  return (
    <View style={styles.stack}>
      <SectionHint>
        Flüge, Züge, Ziele, To-dos, Erinnerungen und Wecker — alles Logistische,
        das Findus im Blick behält.
      </SectionHint>

      {muteLine !== 'Nicht stumm' && (
        <Card title="Stumm-Session">
          <Bullet>{muteLine}</Bullet>
        </Card>
      )}

      {bus && (
        <Card title="Aktiver Bus/Bahn-Reminder">
          <Bullet>
            {bus.line} um {formatClockMs(bus.departure.getTime())} · Los{' '}
            {formatClockMs(bus.leaveBy.getTime())}
          </Bullet>
          <Text style={styles.meta}>
            {describeLeavePlan(
              computeLeavePlan({
                departureMs: bus.departure.getTime(),
                walkEtaMin: bus.walkEtaMin,
                mode: 'bus',
                delayMin: 0,
              }),
            )}
          </Text>
        </Card>
      )}

      {wake && (
        <Card title="Wecker-Vorschlag">
          <Bullet>
            Aufstehen {formatClockMs(wake.wakeAtMs)}
            {wake.leaveByMs != null
              ? ` · Los ${formatClockMs(wake.leaveByMs)}`
              : ''}
          </Bullet>
          <Text style={styles.meta}>{wake.reasonLabel}</Text>
        </Card>
      )}

      {plan && (plan.active || plan.savedForLater) && (
        <Card title={plan.savedForLater ? 'Tour für später' : 'Tagesplan'}>
          {plan.savedForLater && plan.activateAtMs != null && (
            <Bullet>Aktivieren ab {formatClockMs(plan.activateAtMs)}</Bullet>
          )}
          {plan.leaveByMs != null && (
            <Bullet>Leave-by {formatClockMs(plan.leaveByMs)}</Bullet>
          )}
          {plan.stops
            .filter((s) => !s.done)
            .map((s) => (
              <Bullet key={s.id}>
                {s.label}
                {s.arriveByMs != null
                  ? ` · bis ${formatClockMs(s.arriveByMs)}`
                  : ''}
              </Bullet>
            ))}
          {plan.stops.every((s) => s.done) && (
            <EmptyLine text="Alle Stops erledigt." />
          )}
        </Card>
      )}

      {tasks.length > 0 && (
        <Card title="Aufgaben / Einkäufe">
          {tasks.map((t) => (
            <Bullet key={t.id}>
              {t.itemLabel}
              {t.dueAtMs != null ? ` · bis ${formatClockMs(t.dueAtMs)}` : ''}
              {t.anchor === 'hotel' ? ' · Hotel' : ''}
            </Bullet>
          ))}
        </Card>
      )}

      {events.length > 0 && (
        <Card title="Logistik-Events">
          {events.map((e) => (
            <View key={e.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Bullet>
                  [{kindLabel(e.kind)}] {e.title}
                  {e.atMs != null ? ` · ${formatClockMs(e.atMs)}` : ''}
                </Bullet>
                {e.detail ? <Text style={styles.meta}>{e.detail}</Text> : null}
              </View>
              <Pressable
                onPress={() => cancelEvent(e.id)}
                hitSlop={8}
                accessibilityLabel="Abbrechen"
              >
                <Text style={styles.linkMuted}>Weg</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      {transitEntities.length > 0 && (
        <Card title="Hotels / Transit (Memory)">
          {transitEntities.map((e) => (
            <Bullet key={e.id}>
              {e.type}: {e.name}
              {e.isConfirmed ? '' : ' (offen)'}
            </Bullet>
          ))}
        </Card>
      )}

      {!bus &&
        !wake &&
        !plan?.active &&
        tasks.length === 0 &&
        events.length === 0 &&
        transitEntities.length === 0 && (
          <EmptyLine text="Keine offene Logistik — Flüge, Züge und To-dos erscheinen hier, sobald Findus sie notiert." />
        )}
    </View>
  );
}

export function PushTriggersPanel() {
  // Stable selectors — filtering in useMemo avoids Maximum update depth
  const allTriggers = useLogisticsTriggerStore((s) => s.triggers);
  const triggers = useMemo(
    () =>
      allTriggers
        .filter((t) => t.status === 'scheduled' || t.status === 'due')
        .sort((a, b) => a.fireAtMs - b.fireAtMs),
    [allTriggers],
  );
  const clearAll = useLogisticsTriggerStore((s) => s.clearAll);
  const [osIds, setOsIds] = useState<string[]>([]);

  const refreshOs = useCallback(() => {
    void getScheduledReminderIds().then(setOsIds);
  }, []);

  useEffect(() => {
    refreshOs();
    const id = setInterval(refreshOs, 8_000);
    return () => clearInterval(id);
  }, [refreshOs]);

  const recentFired = allTriggers
    .filter((t) => t.status === 'fired')
    .sort((a, b) => (b.lastFiredAtMs ?? 0) - (a.lastFiredAtMs ?? 0))
    .slice(0, 6);

  const clearEverything = () => {
    void clearAll();
    void cancelAllFindusReminders().then(refreshOs);
  };

  return (
    <View style={styles.stack}>
      <SectionHint>
        Zeit- und Orts-Trigger, die Findus selbst plant und aktiv überwacht:
        Grob-Check, Vorbereitung, Sicherheitscheck, Aufbruch-Push. Bei Push:
        Route starten oder Taxi. Bei Ausfall/Verspätung/Taxi-Storno: Plan B.
        Wenn du weiter wegläufst, rückt Leave-by automatisch nach vorne.
      </SectionHint>

      {triggers.length > 0 ? (
        <Card title="Geplante Trigger">
          {triggers.map((t: LogisticsTrigger) => (
            <View key={t.id} style={{ marginBottom: 8 }}>
              <Text style={styles.bullet}>• {t.title}</Text>
              <Text style={styles.meta}>{formatTriggerStatusLine(t)}</Text>
              {t.note ? <Text style={styles.meta}>{t.note}</Text> : null}
            </View>
          ))}
        </Card>
      ) : (
        <EmptyLine text="Keine geplanten Trigger — erscheinen z. B. nach Bus-, Zug- oder Flug-Erinnerung." />
      )}

      {osIds.length > 0 && (
        <Card title="OS-Push (System)">
          {osIds.map((id) => (
            <Bullet key={id}>{id}</Bullet>
          ))}
        </Card>
      )}

      {recentFired.length > 0 && (
        <Card title="Zuletzt ausgelöst">
          {recentFired.map((t) => (
            <Bullet key={t.id}>
              {t.title}
              {t.lastFiredAtMs
                ? ` · ${formatClockMs(t.lastFiredAtMs)}`
                : ''}
            </Bullet>
          ))}
        </Card>
      )}

      {(triggers.length > 0 || osIds.length > 0) && (
        <Pressable onPress={clearEverything} style={styles.actionBtn}>
          <Text style={styles.actionText}>Alle Trigger & OS-Push löschen</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Nur User-erstellte zeitliche / Aktivitäts-Trigger aus der Timeline
 * (keine Standard-ÖPNV/Wetter-Automationen).
 */
export function UserTriggersPanel() {
  const plansByDay = useFuturePlanStore((s) => s.plansByDay);
  const planUpdated = useFuturePlanStore((s) => s.plan.updatedAtMs);
  const activeTimer = getActiveTimer();

  const timeTriggers = useMemo(() => {
    const out: Array<{ id: string; title: string; when: string; kind: string }> =
      [];
    for (const plan of Object.values(plansByDay)) {
      for (const s of plan?.stops ?? []) {
        const isTime =
          s.id.startsWith('wake_') ||
          s.id.startsWith('activity_') ||
          s.status === 'trigger_active' ||
          s.emoji === '⏰' ||
          s.emoji === '⏱️' ||
          s.emoji === '😴';
        if (!isTime || s.status === 'done') continue;
        const start = s.plannedStartMs
          ? new Date(s.plannedStartMs).toLocaleString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '—';
        out.push({
          id: s.id,
          title: s.title,
          when: start,
          kind: s.id.startsWith('wake_') ? 'Zeit' : 'Aktivität',
        });
      }
    }
    return out.sort((a, b) => a.when.localeCompare(b.when)).slice(0, 40);
  }, [plansByDay, planUpdated, activeTimer?.endsAtMs]);

  return (
    <View style={styles.stack}>
      <SectionHint>
        Deine zeitlichen Trigger und Aktivitäten aus der Timeline (Wecker,
        Powernap, Timer). Standard-ÖPNV-/Wetter-Automationen erscheinen hier
        nicht. Geo-Trigger: max. 3 Vorschläge, Ortsname statt Koordinaten.
      </SectionHint>
      {activeTimer ? (
        <Card title="Aktiver Timer">
          <Bullet>
            {activeTimer.label} · bis{' '}
            {new Date(activeTimer.endsAtMs).toLocaleTimeString('de-DE', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Bullet>
        </Card>
      ) : null}
      <Card title="Zeitliche Trigger">
        {timeTriggers.length === 0 ? (
          <EmptyLine text="Noch keine zeitlichen Trigger." />
        ) : (
          timeTriggers.map((t) => (
            <Bullet key={t.id}>
              {t.kind}: {t.title} · {t.when}
            </Bullet>
          ))
        )}
      </Card>
      <Card title="Geo-Trigger">
        <EmptyLine text="User-Geo-Trigger erscheinen hier, sobald sie gesetzt sind (max. 3 Orte pro Suche)." />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 4,
  },
  cardTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  bullet: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  bodyText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginLeft: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  linkMuted: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  actionBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: spacing.xs,
  },
  actionText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
});
