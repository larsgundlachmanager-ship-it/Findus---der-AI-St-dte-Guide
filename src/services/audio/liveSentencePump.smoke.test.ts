/**
 * Live-Pump: Push während LLM, Consumer spielt satzweise (Prefetch-Session).
 */
import { createLiveSentencePump, remainingSpeechAfterLead } from './liveSentencePump';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const pump = createLiveSentencePump();
  const got: string[] = [];

  const consume = (async () => {
    for await (const s of pump.sentences) got.push(s);
  })();

  pump.push('Klar, das geht.');
  pump.push('Satz zwei kommt direkt hinterher.');
  pump.push('Und Satz drei schließt an.');
  pump.end();
  await consume;

  assert(got.length === 3, `expected 3 sentences, got ${got.length}`);
  assert(got[0] === 'Klar, das geht.', `first=${got[0]}`);

  const rest = remainingSpeechAfterLead(
    'Ah, so eine Art Schreier, das hört sich super an. Und das ist der Weg durch den Subtype, da steht noch mehr.',
    'Ah, so eine Art Schreier, das hört sich super an.',
  );
  assert(
    /Weg durch den Subtype/.test(rest),
    `rest after lead missing: ${rest}`,
  );
  assert(
    remainingSpeechAfterLead('Nur ein Satz.', 'Nur ein Satz.') === '',
    'identical lead has no rest',
  );
  assert(!pump.hasStarted(), 'start flag is caller-owned');
  assert(pump.markStarted() === true, 'first markStarted');
  assert(pump.markStarted() === false, 'second markStarted');
  assert(pump.hasStarted(), 'hasStarted after mark');

  const late = createLiveSentencePump();
  const lateGot: string[] = [];
  const lateConsume = (async () => {
    for await (const s of late.sentences) lateGot.push(s);
  })();
  await Promise.resolve();
  late.push('Nach dem Warten.');
  late.end();
  await lateConsume;
  assert(lateGot[0] === 'Nach dem Warten.', `late=${lateGot[0]}`);

  console.log('[ok] liveSentencePump push/consume + start flag');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
