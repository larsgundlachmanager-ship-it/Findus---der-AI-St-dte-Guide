/**
 * Settings: Chrome zuerst, dann parallel Personal + Travel + General + City vorwärmen.
 * Tippt der User eine andere Sektion, bricht die Queue ab und lädt die angeforderte.
 */

export type SettingsPrefetchSection =
  | 'city'
  | 'travel'
  | 'personal'
  | 'character'
  | 'general'
  | 'triggers'
  | 'explanations'
  | 'legal'
  | 'internal'
  | 'developer';

export const SETTINGS_DEFAULT_PREFETCH: SettingsPrefetchSection[] = [
  'personal',
  'character',
  'travel',
  'general',
  'city',
];

export type SettingsPrefetchSignal = { aborted: boolean };

export type SettingsSectionLoader = (
  id: SettingsPrefetchSection,
  signal: SettingsPrefetchSignal,
) => Promise<void>;

export type SettingsPrefetchQueue = {
  cancel: () => void;
  start: (ids: SettingsPrefetchSection[]) => number;
  prioritize: (id: SettingsPrefetchSection) => number;
  getEpoch: () => number;
};

async function defaultLoadSettingsSection(
  id: SettingsPrefetchSection,
  signal: SettingsPrefetchSignal,
): Promise<void> {
  if (signal.aborted) return;
  if (id === 'city') {
    const { prefetchNearbyCityCatalog } = await import('../cityCatalogService');
    if (signal.aborted) return;
    await prefetchNearbyCityCatalog();
    return;
  }
  const { prefetchSettingsSectionModules } = await import(
    '../../components/settings/lazySettingsPanels'
  );
  if (signal.aborted) return;
  await prefetchSettingsSectionModules(id);
}

export function createSettingsPrefetchQueue(
  load: SettingsSectionLoader = defaultLoadSettingsSection,
): SettingsPrefetchQueue {
  let epoch = 0;
  const flags = new Map<number, SettingsPrefetchSignal>();

  const cancel = () => {
    epoch += 1;
    for (const flag of flags.values()) flag.aborted = true;
    flags.clear();
  };

  const start = (ids: SettingsPrefetchSection[]) => {
    cancel();
    const my = epoch;
    const signal: SettingsPrefetchSignal = { aborted: false };
    flags.set(my, signal);
    void Promise.all(
      ids.map(async (id) => {
        if (signal.aborted) return;
        try {
          await load(id, signal);
        } catch {
          /* andere Sektionen weiter */
        }
      }),
    );
    return my;
  };

  const prioritize = (id: SettingsPrefetchSection) => start([id]);

  return {
    cancel,
    start,
    prioritize,
    getEpoch: () => epoch,
  };
}

export const settingsPrefetch = createSettingsPrefetchQueue();

export function startDefaultSettingsPrefetch(): number {
  return settingsPrefetch.start(SETTINGS_DEFAULT_PREFETCH);
}

export function prioritizeSettingsSection(id: SettingsPrefetchSection): number {
  return settingsPrefetch.prioritize(id);
}

export function cancelSettingsPrefetch(): void {
  settingsPrefetch.cancel();
}
