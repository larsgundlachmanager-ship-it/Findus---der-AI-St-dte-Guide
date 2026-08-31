/**
 * Offline-first user cloud sync — lokale Dateien bleiben SSOT.
 * Push debounced; Pull bei Login / App-Foreground.
 */

import * as FileSystem from 'expo-file-system';
import { getSupabase, isSupabaseConfigured } from '../supabase';
import {
  getCachedUserProfile,
  getProfileFilePath,
  loadUserProfile,
  saveUserProfile,
  subscribeUserProfile,
} from '../userProfileService';
import { createDefaultProfile, profileHasFinishedSetup, type UserProfile } from '../../types/userProfile';
import {
  finishedCloudProfile,
  mergeCloudUserProfiles as mergeProfilesCore,
} from './userCloudProfileMerge';
import {
  loadStampPassport,
  saveStampPassport,
} from '../navigation/stampPassportPersistence';
import type { VisitedPlaceMemory } from '../ai/sessionMemory';
import {
  useFuturePlanStore,
  type FuturePlanState,
} from '../../module2/timeline/futurePlanState';
import {
  useHistoricalTimelineStore,
  type HistoricalEntry,
} from '../../module2/timeline/historicalTimelineState';
import { schedulePlanTimelinePersist } from '../../module2/timeline/planPersistence';
import { useUserMemoryStore, type UserEntity, type TravelItinerary } from '../../store/useUserMemoryStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  getLastAuthUser,
  mergeAuthIntoProfile,
  refreshAuthSession,
} from './findusAuth';
import {
  applyStampPassportUxPrefsFromCloud,
  loadStampPassportUxPrefs,
} from '../ui/stampPassportUxPrefs';
import {
  applyFeatureTipStateFromCloud,
  loadFeatureTipState,
} from '../ai/featureTips';
import {
  applyLowChatterStateFromCloud,
  snapshotLowChatterState,
} from '../persona/lowChatterMode';
import {
  applyWalkTrackFromCloud,
  loadWalkTrack,
  snapshotWalkTrackForCloud,
} from '../discovery/walkTrackService';
import {
  applyVisitLogFromCloud,
  hydrateVisitLog,
  snapshotVisitLogForCloud,
} from '../timeline/visitLog';

const PLAN_PATH = `${FileSystem.documentDirectory}findus-plan-timeline-v1.json`;
const META_PATH = `${FileSystem.documentDirectory}findus-cloud-sync-meta.json`;

const PUSH_DEBOUNCE_MS = 45_000;

type SyncTable =
  | 'user_profiles'
  | 'user_stamps'
  | 'user_timeline'
  | 'user_memory'
  | 'user_settings_extras';

type CloudRow = {
  user_id: string;
  payload: unknown;
  updated_at: string;
  content_hash: string | null;
};

type TimelinePayload = {
  futurePlans: Record<string, FuturePlanState>;
  historical: HistoricalEntry[];
  savedAt: number;
};

type MemoryPayload = {
  entities: UserEntity[];
  travelItinerary?: TravelItinerary;
  learnedFacts: string[];
  learnedRules?: import('../../types/learnedRules').LearnedRule[];
  updatedAt: string;
};

type SyncMeta = {
  lastUploadedHash: Partial<Record<SyncTable, string>>;
};

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
let watchersStarted = false;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function contentHash(payload: unknown): string {
  let h = 2166136261;
  const s = stableStringify(payload);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function readMeta(): Promise<SyncMeta> {
  try {
    const info = await FileSystem.getInfoAsync(META_PATH);
    if (!info.exists) return { lastUploadedHash: {} };
    const raw = await FileSystem.readAsStringAsync(META_PATH);
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    return { lastUploadedHash: parsed.lastUploadedHash ?? {} };
  } catch {
    return { lastUploadedHash: {} };
  }
}

async function writeMeta(meta: SyncMeta): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(META_PATH, JSON.stringify(meta));
  } catch {
    /* soft */
  }
}

export async function getSyncUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const auth = getLastAuthUser() ?? (await refreshAuthSession());
  if (!auth?.id) return null;
  const profile = getCachedUserProfile();
  if (profile?.accountMode === 'guest') return null;
  return auth.id;
}

function canCloudSync(): boolean {
  if (!isSupabaseConfigured()) return false;
  const profile = getCachedUserProfile();
  if (profile?.accountMode === 'guest') return false;
  return !!getLastAuthUser();
}

async function fetchRow(
  table: SyncTable,
  userId: string,
): Promise<CloudRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from(table)
    .select('user_id,payload,updated_at,content_hash')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CloudRow;
}

async function upsertRow(
  table: SyncTable,
  userId: string,
  payload: unknown,
  hash: string,
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const updated_at = new Date().toISOString();
  const { error } = await sb.from(table).upsert(
    {
      user_id: userId,
      payload,
      updated_at,
      content_hash: hash,
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    console.warn(`[userCloudSync] upsert ${table} failed:`, error.message);
    return false;
  }
  return true;
}

function profileEnvelope(profile: UserProfile): {
  profile: UserProfile;
  updatedAt: string;
} {
  return {
    profile,
    updatedAt: new Date().toISOString(),
  };
}

function mergeProfiles(
  local: UserProfile,
  localUpdatedAt: string,
  remote: { profile: UserProfile; updatedAt: string } | null,
): UserProfile {
  if (!remote) return local;
  const auth = getLastAuthUser();
  const authBase =
    profileHasFinishedSetup(remote.profile) && !profileHasFinishedSetup(local)
      ? remote.profile
      : local;
  const authPatch = auth ? mergeAuthIntoProfile(authBase, auth) : {};
  return mergeProfilesCore(local, localUpdatedAt, remote, authPatch);
}

function mergeStamps(
  local: VisitedPlaceMemory[],
  remote: VisitedPlaceMemory[],
): VisitedPlaceMemory[] {
  const map = new Map<string, VisitedPlaceMemory>();
  const key = (e: VisitedPlaceMemory) => `${e.poiId}:${e.visitedAt}`;
  for (const e of remote) map.set(key(e), e);
  for (const e of local) map.set(key(e), e);
  return [...map.values()].sort((a, b) => a.visitedAt - b.visitedAt).slice(-8_000);
}

function mergeTimeline(
  local: TimelinePayload,
  remote: TimelinePayload,
): TimelinePayload {
  const futurePlans: Record<string, FuturePlanState> = { ...local.futurePlans };
  for (const [dayKey, remotePlan] of Object.entries(remote.futurePlans ?? {})) {
    const localPlan = futurePlans[dayKey];
    if (!localPlan) {
      futurePlans[dayKey] = remotePlan;
      continue;
    }
    const localTs = localPlan.updatedAtMs ?? 0;
    const remoteTs = remotePlan.updatedAtMs ?? 0;
    futurePlans[dayKey] = remoteTs >= localTs ? remotePlan : localPlan;
  }

  const byDaySavedAt = (
    entries: HistoricalEntry[],
    savedAt: number,
  ): Map<string, { savedAt: number; entries: HistoricalEntry[] }> => {
    const m = new Map<string, { savedAt: number; entries: HistoricalEntry[] }>();
    for (const e of entries) {
      const cur = m.get(e.dayKey);
      if (!cur) {
        m.set(e.dayKey, { savedAt, entries: [e] });
      } else {
        cur.entries.push(e);
      }
    }
    return m;
  };

  const localDays = byDaySavedAt(local.historical ?? [], local.savedAt ?? 0);
  const remoteDays = byDaySavedAt(remote.historical ?? [], remote.savedAt ?? 0);
  const dayKeys = new Set([...localDays.keys(), ...remoteDays.keys()]);
  const historical: HistoricalEntry[] = [];

  for (const dayKey of dayKeys) {
    const l = localDays.get(dayKey);
    const r = remoteDays.get(dayKey);
    if (l && r) {
      historical.push(...(r.savedAt >= l.savedAt ? r.entries : l.entries));
    } else if (l) {
      historical.push(...l.entries);
    } else if (r) {
      historical.push(...r.entries);
    }
  }

  const byId = new Map<string, HistoricalEntry>();
  for (const e of historical) byId.set(e.id, e);

  return {
    futurePlans,
    historical: [...byId.values()].sort((a, b) => a.atMs - b.atMs),
    savedAt: Math.max(local.savedAt ?? 0, remote.savedAt ?? 0, Date.now()),
  };
}

function mergeMemory(local: MemoryPayload, remote: MemoryPayload): MemoryPayload {
  const entitiesById = new Map<string, UserEntity>();
  for (const e of remote.entities ?? []) entitiesById.set(e.id, e);
  for (const e of local.entities ?? []) {
    const cur = entitiesById.get(e.id);
    if (!cur) {
      entitiesById.set(e.id, e);
      continue;
    }
    const curAt = cur.visitedAt ?? '';
    const nextAt = e.visitedAt ?? '';
    entitiesById.set(e.id, nextAt >= curAt ? e : cur);
  }

  const factSet = new Set<string>();
  for (const f of [...(remote.learnedFacts ?? []), ...(local.learnedFacts ?? [])]) {
    const t = String(f).trim();
    if (t) factSet.add(t);
  }
  const learnedFacts = [...factSet].slice(-40);

  let learnedRules = local.learnedRules ?? remote.learnedRules ?? [];
  try {
    const { mergeLearnedRules, normalizeLearnedRules } = require('../memory/correctionLearning') as {
      mergeLearnedRules: (
        a: NonNullable<MemoryPayload['learnedRules']>,
        b: NonNullable<MemoryPayload['learnedRules']>,
      ) => NonNullable<MemoryPayload['learnedRules']>;
      normalizeLearnedRules: (
        raw: unknown,
      ) => NonNullable<MemoryPayload['learnedRules']>;
    };
    learnedRules = mergeLearnedRules(
      normalizeLearnedRules(local.learnedRules ?? []),
      normalizeLearnedRules(remote.learnedRules ?? []),
    );
  } catch {
    /* soft */
  }

  return {
    entities: [...entitiesById.values()].slice(-200),
    travelItinerary: local.travelItinerary ?? remote.travelItinerary,
    learnedFacts,
    learnedRules,
    updatedAt: new Date().toISOString(),
  };
}

async function readLocalTimeline(): Promise<TimelinePayload> {
  try {
    const info = await FileSystem.getInfoAsync(PLAN_PATH);
    if (!info.exists) {
      return {
        futurePlans: useFuturePlanStore.getState().plansByDay,
        historical: useHistoricalTimelineStore.getState().entries,
        savedAt: Date.now(),
      };
    }
    const raw = await FileSystem.readAsStringAsync(PLAN_PATH);
    const parsed = JSON.parse(raw) as Partial<TimelinePayload>;
    return {
      futurePlans:
        parsed.futurePlans ??
        useFuturePlanStore.getState().plansByDay,
      historical:
        parsed.historical ?? useHistoricalTimelineStore.getState().entries,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch {
    return {
      futurePlans: useFuturePlanStore.getState().plansByDay,
      historical: useHistoricalTimelineStore.getState().entries,
      savedAt: Date.now(),
    };
  }
}

async function writeLocalTimeline(payload: TimelinePayload): Promise<void> {
  useFuturePlanStore.getState().hydratePlans(payload.futurePlans);
  useHistoricalTimelineStore.getState().hydrateEntries(payload.historical);
  await FileSystem.writeAsStringAsync(PLAN_PATH, JSON.stringify(payload));
  schedulePlanTimelinePersist();
}

type SettingsExtrasPayload = {
  stampPassportUx: unknown;
  featureTips?: unknown;
  lowChatter?: unknown;
  walkTrack?: { points: unknown; updatedAt: string };
  visits?: { entries: unknown; updatedAt: string };
  updatedAt: string;
};

async function buildLocalSnapshots(): Promise<{
  profile: ReturnType<typeof profileEnvelope>;
  stamps: { entries: VisitedPlaceMemory[]; updatedAt: string };
  timeline: TimelinePayload;
  memory: MemoryPayload;
  settingsExtras: SettingsExtrasPayload;
}> {
  const profile = getCachedUserProfile() ?? (await loadUserProfile());
  const stamps = await loadStampPassport();
  const timeline = await readLocalTimeline();
  await useUserMemoryStore.getState().hydrate();
  const memState = useUserMemoryStore.getState();
  const stampUx = await loadStampPassportUxPrefs();
  const featureTips = await loadFeatureTipState();
  const lowChatter = await snapshotLowChatterState();
  await loadWalkTrack();
  await hydrateVisitLog();
  const learnedFacts = profile?.learnedFacts ?? [];
  const learnedRules = profile?.learnedRules ?? [];

  const baseProfile =
    profile ?? (await loadUserProfile()) ?? createDefaultProfile();
  return {
    profile: profileEnvelope(baseProfile),
    stamps: { entries: stamps, updatedAt: new Date().toISOString() },
    timeline,
    memory: {
      entities: memState.entities,
      travelItinerary: memState.travelItinerary,
      learnedFacts: [...learnedFacts],
      learnedRules: [...learnedRules],
      updatedAt: new Date().toISOString(),
    },
    settingsExtras: {
      stampPassportUx: stampUx,
      featureTips,
      lowChatter,
      walkTrack: {
        points: snapshotWalkTrackForCloud(),
        updatedAt: new Date().toISOString(),
      },
      visits: {
        entries: snapshotVisitLogForCloud(),
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function syncMarketingRow(
  userId: string,
  optIn: boolean,
  optInAt: string | null,
  locale: string,
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Supabase nicht konfiguriert' };
  const { error } = await sb.from('user_marketing').upsert(
    {
      user_id: userId,
      newsletter_opt_in: optIn,
      opt_in_at: optIn ? optInAt ?? new Date().toISOString() : null,
      locale,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function pullMarketing(userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data } = await sb
    .from('user_marketing')
    .select('newsletter_opt_in,opt_in_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return;
  const local = getCachedUserProfile();
  if (!local) return;
  if (
    local.newsletterOptIn === data.newsletter_opt_in &&
    local.newsletterOptInAt === data.opt_in_at
  ) {
    return;
  }
  await saveUserProfile({
    ...local,
    newsletterOptIn: !!data.newsletter_opt_in,
    newsletterOptInAt: data.opt_in_at ?? null,
  });
}

export async function pullUserCloudOnLogin(): Promise<void> {
  const userId = await getSyncUserId();
  if (!userId) return;

  try {
    const localProfile = (await loadUserProfile()) ?? getCachedUserProfile();
    let localUpdatedAt = new Date(0).toISOString();
    try {
      const info = await FileSystem.getInfoAsync(getProfileFilePath());
      if (info.exists && 'modificationTime' in info && info.modificationTime) {
        localUpdatedAt = new Date(info.modificationTime * 1000).toISOString();
      }
    } catch {
      /* soft */
    }

    const remoteProfileRow = await fetchRow('user_profiles', userId);
    const remoteEnv = remoteProfileRow?.payload as
      | { profile: UserProfile; updatedAt: string }
      | undefined;
    const remoteUpdatedAt =
      remoteEnv?.updatedAt ?? remoteProfileRow?.updated_at ?? '';
    if (localProfile && remoteEnv?.profile) {
      const merged = mergeProfiles(localProfile, localUpdatedAt, {
        profile: remoteEnv.profile,
        updatedAt: remoteUpdatedAt,
      });
      await saveUserProfile(merged);
    } else if (!localProfile && remoteEnv?.profile) {
      await saveUserProfile(
        profileHasFinishedSetup(remoteEnv.profile)
          ? finishedCloudProfile(remoteEnv.profile)
          : remoteEnv.profile,
      );
    }

    const localStamps = await loadStampPassport();
    const remoteStampsRow = await fetchRow('user_stamps', userId);
    const remoteStamps = (remoteStampsRow?.payload as { entries?: VisitedPlaceMemory[] })
      ?.entries;
    if (remoteStamps?.length) {
      const merged = mergeStamps(localStamps, remoteStamps);
      await saveStampPassport(merged);
      useFinnusStore.setState({ visitedHistory: merged });
    }

    const localTimeline = await readLocalTimeline();
    const remoteTimelineRow = await fetchRow('user_timeline', userId);
    const remoteTimeline = remoteTimelineRow?.payload as TimelinePayload | undefined;
    if (remoteTimeline) {
      const merged = mergeTimeline(localTimeline, remoteTimeline);
      await writeLocalTimeline(merged);
    }

    const remoteMemoryRow = await fetchRow('user_memory', userId);
    const remoteMemory = remoteMemoryRow?.payload as MemoryPayload | undefined;
    await useUserMemoryStore.getState().hydrate();
    const localMemory: MemoryPayload = {
      entities: useUserMemoryStore.getState().entities,
      travelItinerary: useUserMemoryStore.getState().travelItinerary,
      learnedFacts: getCachedUserProfile()?.learnedFacts ?? [],
      learnedRules: getCachedUserProfile()?.learnedRules ?? [],
      updatedAt: new Date().toISOString(),
    };
    if (remoteMemory) {
      const merged = mergeMemory(localMemory, remoteMemory);
      useUserMemoryStore.setState({
        entities: merged.entities,
        travelItinerary: merged.travelItinerary,
      });
      await useUserMemoryStore.getState().persist();
      const prof = getCachedUserProfile();
      if (prof && (merged.learnedFacts.length || merged.learnedRules?.length)) {
        await saveUserProfile({
          ...prof,
          learnedFacts: merged.learnedFacts,
          ...(merged.learnedRules ? { learnedRules: merged.learnedRules } : {}),
        });
      }
    }

    const remoteExtrasRow = await fetchRow('user_settings_extras', userId);
    const remoteExtras = remoteExtrasRow?.payload as
      | SettingsExtrasPayload
      | undefined;
    if (remoteExtras) {
      await applyStampPassportUxPrefsFromCloud(
        remoteExtras.stampPassportUx as never,
      );
      await applyFeatureTipStateFromCloud(remoteExtras.featureTips as never);
      await applyLowChatterStateFromCloud(remoteExtras.lowChatter as never);
      const remoteWalk = remoteExtras.walkTrack?.points;
      if (Array.isArray(remoteWalk) && remoteWalk.length) {
        await applyWalkTrackFromCloud(remoteWalk as never);
      }
      const remoteVisits = remoteExtras.visits?.entries;
      if (Array.isArray(remoteVisits) && remoteVisits.length) {
        await applyVisitLogFromCloud(remoteVisits as never);
      }
    }

    await pullMarketing(userId);
  } catch (err) {
    console.warn('[userCloudSync] pull failed:', err);
  }
}

async function pushUserCloud(): Promise<void> {
  if (pushInFlight) return;
  const userId = await getSyncUserId();
  if (!userId) return;

  pushInFlight = true;
  try {
    const meta = await readMeta();
    const snapshots = await buildLocalSnapshots();

    const profilePayload = snapshots.profile;
    const profileHash = contentHash(profilePayload);
    if (meta.lastUploadedHash.user_profiles !== profileHash) {
      const localP = profilePayload.profile;
      let skipProfile = false;
      if (!profileHasFinishedSetup(localP)) {
        const remoteDoneRow = await fetchRow('user_profiles', userId);
        const remoteP = (
          remoteDoneRow?.payload as { profile?: UserProfile } | undefined
        )?.profile;
        skipProfile = profileHasFinishedSetup(remoteP);
      }
      if (!skipProfile) {
        const ok = await upsertRow(
          'user_profiles',
          userId,
          profilePayload,
          profileHash,
        );
        if (ok) meta.lastUploadedHash.user_profiles = profileHash;
      }
    }

    const stampsPayload = snapshots.stamps;
    const stampsHash = contentHash(stampsPayload);
    if (meta.lastUploadedHash.user_stamps !== stampsHash) {
      const ok = await upsertRow(
        'user_stamps',
        userId,
        stampsPayload,
        stampsHash,
      );
      if (ok) meta.lastUploadedHash.user_stamps = stampsHash;
    }

    const timelineHash = contentHash(snapshots.timeline);
    if (meta.lastUploadedHash.user_timeline !== timelineHash) {
      const ok = await upsertRow(
        'user_timeline',
        userId,
        snapshots.timeline,
        timelineHash,
      );
      if (ok) meta.lastUploadedHash.user_timeline = timelineHash;
    }

    const memoryHash = contentHash(snapshots.memory);
    if (meta.lastUploadedHash.user_memory !== memoryHash) {
      const ok = await upsertRow(
        'user_memory',
        userId,
        snapshots.memory,
        memoryHash,
      );
      if (ok) meta.lastUploadedHash.user_memory = memoryHash;
    }

    const extrasHash = contentHash(snapshots.settingsExtras);
    if (meta.lastUploadedHash.user_settings_extras !== extrasHash) {
      const ok = await upsertRow(
        'user_settings_extras',
        userId,
        snapshots.settingsExtras,
        extrasHash,
      );
      if (ok) meta.lastUploadedHash.user_settings_extras = extrasHash;
    }

    const prof = getCachedUserProfile();
    if (prof) {
      await syncMarketingRow(
        userId,
        !!prof.newsletterOptIn,
        prof.newsletterOptInAt ?? null,
        prof.language ?? 'de',
      );
    }

    await writeMeta(meta);
  } catch (err) {
    console.warn('[userCloudSync] push failed:', err);
  } finally {
    pushInFlight = false;
  }
}

export function scheduleUserCloudPush(): void {
  if (!canCloudSync()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushUserCloud();
  }, PUSH_DEBOUNCE_MS);
}

export async function forceUserCloudSync(): Promise<void> {
  if (!(await getSyncUserId())) return;
  await pullUserCloudOnLogin();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await pushUserCloud();
}

export function startUserCloudSyncWatchers(): () => void {
  if (watchersStarted) return () => undefined;
  watchersStarted = true;

  const unsubProfile = subscribeUserProfile(() => scheduleUserCloudPush());
  const unsubStamps = useFinnusStore.subscribe((state, prev) => {
    if (state.visitedHistory !== prev.visitedHistory) {
      scheduleUserCloudPush();
    }
  });
  const unsubPlan = useFuturePlanStore.subscribe(() => scheduleUserCloudPush());
  const unsubHist = useHistoricalTimelineStore.subscribe(() =>
    scheduleUserCloudPush(),
  );
  const unsubMem = useUserMemoryStore.subscribe((state, prev) => {
    if (
      state.entities !== prev.entities ||
      state.travelItinerary !== prev.travelItinerary
    ) {
      scheduleUserCloudPush();
    }
  });

  return () => {
    watchersStarted = false;
    unsubProfile();
    unsubStamps();
    unsubPlan();
    unsubHist();
    unsubMem();
    if (pushTimer) clearTimeout(pushTimer);
  };
}
