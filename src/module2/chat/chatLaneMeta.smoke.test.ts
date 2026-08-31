/**
 * Run: npx --yes --package tsx@4.19.3 tsx src/module2/chat/chatLaneMeta.smoke.test.ts
 */
import { stripChatLaneMeta } from './chatLaneMeta';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const leaked =
  'Leicht bis stark bewölkt bei Höchstwerten um 17 Grad. WANT_REMINDER: no';
const clean = stripChatLaneMeta(leaked);
assert(!/WANT_REMINDER/i.test(clean), `stripped tag: ${clean}`);
assert(/17/.test(clean), 'keeps weather numbers');
assert(
  !/LOCAL_SHOW/i.test(stripChatLaneMeta('Regen. LOCAL_SHOW: none')),
  'strips LOCAL_SHOW',
);

console.log('chatLaneMeta.smoke.test.ts OK');
