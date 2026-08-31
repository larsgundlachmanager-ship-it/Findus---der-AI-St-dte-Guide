const { rewriteQuery } = require('../src/module2/pipeline/queryRewriter');
const { classifyUtteranceFamily } = require('../src/module2/kernel/utteranceFamily');
const {
  looksLikeFollowUpLite,
  resolveTurnBridgePace,
  decideTopicCut,
  shouldScrubDeadThread,
} = require('../src/module2/kernel/turnKernel');

const q = 'Wie wird das Wetter morgen?';
const rw = rewriteQuery(q, {
  lastPlaceName: 'Flughafen Wien',
  lastTopic: 'Flug nach Wien',
  lastAssistantSnippet: 'Wann startet dein Flug? Soll ich Leave-by rechnen?',
});
console.log('rewrite', JSON.stringify(rw));
console.log('fam', classifyUtteranceFamily(q).family, '→', classifyUtteranceFamily(rw.rewritten).family);
console.log('followUpLite', looksLikeFollowUpLite(q));
console.log('pace', resolveTurnBridgePace(q));
const mode = decideTopicCut({
  userText: q,
  openLoopLabel: 'Flug nach Wien Leave-by',
  foregroundLabel: 'Flug Wien',
});
console.log('topicCut', mode, 'scrub', shouldScrubDeadThread(mode));
