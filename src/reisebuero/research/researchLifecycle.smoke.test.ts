/**
 * Smoke: Research-Lifecycle Copy (ohne RN/Notifications).
 */
import assert from 'node:assert/strict';
import {
  buildResearchDoneBody,
  resolveResearchNotifyFirstName,
} from './researchLifecycleCopy';

assert.equal(resolveResearchNotifyFirstName('lars'), 'Lars');
assert.equal(resolveResearchNotifyFirstName('  Maria Sophie '), 'Maria');
assert.equal(resolveResearchNotifyFirstName(''), null);
assert.equal(resolveResearchNotifyFirstName('X'), null);

assert.equal(buildResearchDoneBody('Lars'), 'Hey Lars, ich bin fertig.');
assert.equal(buildResearchDoneBody(null), 'Hey, ich bin fertig.');
assert.equal(buildResearchDoneBody(''), 'Hey, ich bin fertig.');

console.log('researchLifecycle.smoke: ok');
