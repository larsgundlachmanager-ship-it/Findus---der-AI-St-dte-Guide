/**
 * Run: npx --yes tsx src/module2/agents/mobilityTransitShortHop.smoke.test.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { humanizeAgentDraft } from '../speech/draftToHumanSpeech';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const src = readFileSync(
  join(process.cwd(), 'src/module2/agents/mobilityAgent.ts'),
  'utf8',
);
assert(src.includes('buildShortHopNoTransitResult'), 'short-hop helper');
assert(src.includes('transitNotWorthIt'), 'meta flag');
assert(/öffentlichen?\s+verkehr/i.test(src) || /verkehrsmittel/i.test(src), 'öffentlich match');
assert(src.includes('getActiveNavDestination'), 'sticky live dest');

assert(
  !shouldSpeakMeta(
    humanizeAgentDraft(
      'SICHTBARKEIT: nein. User sieht den Ort JETZT vermutlich nicht. KEINE Formulierungen. PACK-DATENSATZ Tennis. TOPIC-LOCK: hier. Nein Bus lohnt nicht.',
    ),
  ),
  'humanize drops visibility/pack meta',
);

function shouldSpeakMeta(s: string): boolean {
  return /SICHTBARKEIT|vermutlich nicht|PACK-DATENSATZ|TOPIC-LOCK|KEINE Formulierungen/i.test(
    s,
  );
}

assert(
  /Bus|Bahn|Fuß|Taxi|Uber|lohnt/i.test(
    humanizeAgentDraft(
      'Nein — Bus oder Bahn lohnt sich hier nicht. Zu Fuß bist du am schnellsten, noch etwa 16 Minuten. Taxi oder Uber geht natürlich auch.',
    ),
  ),
  'short-hop speech stays',
);

console.log('mobilityTransitShortHop.smoke.test.ts OK');
