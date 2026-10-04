/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/reboot/managerTurn.bridge.smoke.test.ts
 */
import { shouldSuppressBridge } from './managerTurn';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  shouldSuppressBridge({
    topicMode: 'continue',
    jobId: 'dining_open',
    userText: 'Kann man hier SUP ausleihen?',
  }) === false,
  'SUP follow-up darf Bridge behalten',
);
assert(
  shouldSuppressBridge({
    topicMode: 'continue',
    jobId: 'nav_route',
    userText: 'Stell die Route auf Fahrrad um',
  }) === false,
  'bike switch darf Bridge behalten',
);
assert(
  shouldSuppressBridge({
    topicMode: 'continue',
    jobId: 'dining_open',
    userText: 'ja',
  }) === true,
  'Mikro-Ack unterdrückt Bridge',
);
assert(
  shouldSuppressBridge({
    topicMode: 'new',
    jobId: 'dining_open',
    userText: 'All you can eat kein asiatisch',
  }) === false,
  'new wish behält Bridge',
);

console.log('managerTurn.bridge.smoke.test.ts OK');
