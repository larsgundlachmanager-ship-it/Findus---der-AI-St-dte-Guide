/**
 * Run: npx --yes tsx src/module2/planning/offerActionUtils.smoke.test.ts
 */
import { detectOfferKind } from './offerActionUtils';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(detectOfferKind('Michel Aussichtsplattform Tickets') === 'ticket', 'michel is ticket');
assert(detectOfferKind('St. Michaelis Kirche Hamburg') === 'ticket', 'church is ticket');
assert(detectOfferKind('Pannfisch Restaurant Elbblick') === 'menu', 'dinner stays menu');
assert(detectOfferKind('Hotel Speicherstadt') === 'web', 'hotel not ticket here');

console.log('offerActionUtils.smoke.test.ts ok');
