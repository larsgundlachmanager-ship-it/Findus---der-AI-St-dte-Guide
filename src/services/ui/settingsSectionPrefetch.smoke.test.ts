/**
 * Run: npx --yes tsx src/services/ui/settingsSectionPrefetch.smoke.test.ts
 */

import { createSettingsPrefetchQueue } from './settingsSectionPrefetch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const started: string[] = [];
  const finished: string[] = [];

  const queue = createSettingsPrefetchQueue(async (id, signal) => {
    started.push(id);
    await delay(40);
    if (signal.aborted) return;
    finished.push(id);
  });

  queue.start(['travel', 'general']);
  await delay(10);
  queue.prioritize('explanations');
  await delay(80);

  assert(started[0] === 'travel', 'Default startet mit aktueller Reise');
  assert(
    started.includes('explanations'),
    'User-Tap lädt die angeforderte Sektion',
  );
  assert(
    !finished.includes('travel'),
    'abgebrochene Reise-Vorladung darf nicht als fertig gelten',
  );
  assert(
    !started.includes('general') || !finished.includes('general'),
    'General nach Fehl-Vorhersage nicht weiterladen',
  );
  assert(finished.includes('explanations'), 'getippte Sektion wird fertig');

  const second = createSettingsPrefetchQueue(async (id, signal) => {
    await delay(5);
    if (signal.aborted) return;
    finished.push(`ok:${id}`);
  });
  second.start(['travel', 'general']);
  await delay(30);
  assert(
    finished.includes('ok:travel') && finished.includes('ok:general'),
    'Default-Queue ohne Tap lädt Reise und Allgemein',
  );

  console.log('settingsSectionPrefetch.smoke.test.ts OK');
}

void run().catch((err) => {
  console.error(err);
  process.exit(1);
});
