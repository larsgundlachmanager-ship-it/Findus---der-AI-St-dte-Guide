/**
 * Run: npx --yes tsx src/module2/planning/planConfirmAck.smoke.test.ts
 */
import { rewriteQuery } from '../pipeline/queryRewriter';
import {
  isBarePlanAck,
  isPlanConfirmNo,
  isPlanConfirmYes,
} from './planConfirmAck';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(isPlanConfirmYes('ja'), 'ja = yes');
assert(isPlanConfirmYes('Ja.'), 'Ja. = yes');
assert(isPlanConfirmYes('ja bitte'), 'ja bitte = yes');
assert(isPlanConfirmYes('wechseln'), 'wechseln = yes');
assert(!isPlanConfirmYes('nein'), 'nein not yes');
assert(!isPlanConfirmYes('ja nicht'), 'ja nicht not yes');
assert(isPlanConfirmNo('nein'), 'nein = no');
assert(isPlanConfirmNo('später'), 'später = no');
assert(isBarePlanAck('ja'), 'bare ja');
assert(isBarePlanAck('Nein'), 'bare nein');
assert(isBarePlanAck('Nein, Pinneberg') === false, 'city correction not bare');

const rewritten = rewriteQuery('ja', {
  lastPlaceName: 'Prisdorf',
  lastTopic: 'Tagesplan',
  lastAssistantSnippet:
    'Für Recherchen in Hamburg brauche ich den Hamburg-Datensatz. Wollen wir einmal darauf wechseln?',
});
assert(rewritten.rewritten.startsWith('ja'), `ja stays ja, got: ${rewritten.rewritten}`);
assert(/gerade gefragt/i.test(rewritten.rewritten), 'ja binds last question');
assert(!/Ort: Prisdorf/i.test(rewritten.rewritten), 'ja not glued to old place');
assert(isPlanConfirmYes(rewritten.rewritten), 'rewritten ja still yes');

const luggageJa = rewriteQuery('ja', {
  lastPlaceName: 'Elbphilharmonie',
  lastTopic: 'Hamburg Plan',
  lastAssistantSnippet:
    'Hab A3825 nach Athen um 11:05 Uhr gefunden. Fliegst du mit Aufgabegepäck oder nur mit Handgepäck?',
});
assert(/Aufgabegepäck/i.test(luggageJa.rewritten), 'ja binds luggage ask');
assert(!/Elbphilharmonie/i.test(luggageJa.rewritten), 'ja not old Hamburg place');

console.log('planConfirmAck.smoke.test.ts ok');
