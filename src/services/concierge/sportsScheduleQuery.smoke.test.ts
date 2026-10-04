/**
 * Named schedule subject hard-match + Barclaycard alias.
 * Run: npx --yes tsx src/services/concierge/sportsScheduleQuery.smoke.test.ts
 */
import {
  looksLikeNamedScheduleQuery,
  extractNamedScheduleSubjects,
  eventMatchesNamedScheduleSubject,
} from './sportsScheduleQuery';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const towers =
  'Ich habe überlegt, zu den Hamburg Towers dieses Jahr zu gehen. Wann ist das nächste Spiel für die Barclaycard Arena?';
assert(looksLikeNamedScheduleQuery(towers), 'towers+barclaycard named');
const subjects = extractNamedScheduleSubjects(towers);
assert(
  subjects.some((s) => /towers/i.test(s)),
  `subjects include Towers, got ${subjects.join('|')}`,
);

assert(
  eventMatchesNamedScheduleSubject(
    { title: 'Hamburg Towers vs Bonn', venue: 'Barclays Arena', summary: 'BBL' },
    subjects,
  ),
  'towers game matches',
);
assert(
  !eventMatchesNamedScheduleSubject(
    { title: 'Vita Was da los Tour', venue: 'Logo Hamburg', summary: 'Konzert' },
    subjects,
  ),
  'concert does not match Towers',
);

assert(
  looksLikeNamedScheduleQuery('Wann spielen die Hamburg Towers in der Barclaycard Arena?'),
  'barclaycard venue alias',
);

console.log('sportsScheduleQuery.smoke.test.ts OK');
