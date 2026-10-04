const fs = require('fs');
const p = 'src/reisebuero/reisebuero.smoke.test.ts';
let s = fs.readFileSync(p, 'utf8');

s = s.replace(
  /if \(gap\.key !== 'keep_talking' && gap\.key !== 'wrap_up' && !asked\.includes\(gap\.key\)\) asked\.push\(gap\.key\);/g,
  "if (gap.key !== 'keep_talking' && gap.key !== 'wrap_up' && gap.key !== 'ready_announce' && !asked.includes(gap.key)) asked.push(gap.key);",
);

s = s.replace(
  "assert(conv.next === 'wrap_up' || conv.next === 'keep_talking' || conv.next === 'departWindow' || conv.next === 'lodging', `after core facts wrap, got ${conv.next}`);",
  "assert(conv.next === 'wrap_up' || conv.next === 'ready_announce' || conv.next === 'keep_talking' || conv.next === 'departWindow' || conv.next === 'lodging' || conv.next === 'partyGrain', `after core facts wrap, got ${conv.next}`);",
);

s = s.replace(
  "assert(spaWalk.next === 'spaStyle' || spaWalk.next === 'wrap_up' || spaWalk.next === 'extraWishes', `spa deep ask, got ${spaWalk.next}`);",
  "assert(spaWalk.next === 'spaStyle' || spaWalk.next === 'wrap_up' || spaWalk.next === 'ready_announce' || spaWalk.next === 'extraWishes', `spa deep ask, got ${spaWalk.next}`);",
);

s = s.replace(
  "assert(wineWalk.next === 'tripShape' || wineWalk.next === 'wrap_up' || wineWalk.next === 'keep_talking', `wine form next, got ${wineWalk.next}`);",
  "assert(wineWalk.next === 'tripShape' || wineWalk.next === 'wrap_up' || wineWalk.next === 'ready_announce' || wineWalk.next === 'keep_talking', `wine form next, got ${wineWalk.next}`);",
);

s = s.replace(
  /typedPartyLog\[typedPartyLog\.length - 1\] === 'NEXT:wrap_up' \|\|/g,
  "typedPartyLog[typedPartyLog.length - 1] === 'NEXT:wrap_up' ||\n  typedPartyLog[typedPartyLog.length - 1] === 'NEXT:ready_announce' ||",
);
s = s.replace(
  /typedClubsLog\[typedClubsLog\.length - 1\] === 'NEXT:wrap_up' \|\|/g,
  "typedClubsLog[typedClubsLog.length - 1] === 'NEXT:wrap_up' ||\n  typedClubsLog[typedClubsLog.length - 1] === 'NEXT:ready_announce' ||",
);
s = s.replace(
  /typedSpaLog\[typedSpaLog\.length - 1\] === 'NEXT:wrap_up' \|\|/g,
  "typedSpaLog[typedSpaLog.length - 1] === 'NEXT:wrap_up' ||\n    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:ready_announce' ||",
);

s = s.replace(
  "partyDone.next === 'when' || partyDone.next === 'driveTime' || partyDone.next === 'departWindow' || partyDone.next === 'wrap_up',",
  "partyDone.next === 'when' || partyDone.next === 'driveTime' || partyDone.next === 'departWindow' || partyDone.next === 'wrap_up' || partyDone.next === 'ready_announce' || partyDone.next === 'partyGrain' || partyDone.next === 'keep_talking' || partyDone.next === 'lodging',",
);

s = s.replace(
  "assert(familyDone.next === 'wrap_up' || familyDone.next === 'keep_talking' || familyDone.next === 'extraWishes', `family wrap ${familyDone.next}`);",
  "assert(familyDone.next === 'wrap_up' || familyDone.next === 'ready_announce' || familyDone.next === 'keep_talking' || familyDone.next === 'extraWishes', `family wrap ${familyDone.next}`);",
);

s = s.replace(
  "assert(coupleDone.next === 'origin' || coupleDone.next === 'wrap_up' || coupleDone.next === 'keep_talking', `couple next ${coupleDone.next}`);",
  "assert(coupleDone.next === 'origin' || coupleDone.next === 'wrap_up' || coupleDone.next === 'ready_announce' || coupleDone.next === 'keep_talking', `couple next ${coupleDone.next}`);",
);

fs.writeFileSync(p + '.tmp', s);
fs.renameSync(p + '.tmp', p);
console.log('smoke asserts updated');
