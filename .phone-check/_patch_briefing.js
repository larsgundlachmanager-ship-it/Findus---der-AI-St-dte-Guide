const fs = require('fs');
const p = 'src/reisebuero/briefingChat.ts';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('isBriefComplete,')) {
  s = s.replace(
    'buildRecapLines,\n  nextQuestionKey,',
    'buildRecapLines,\n  isBriefComplete,\n  nextQuestionKey,',
  );
}
s = s.replace(/\nimport \{ isBriefComplete \} from '\.\/completeness';\s*$/, '\n');
if (!s.includes("gap.key === 'keep_talking'")) {
  const needle = `if (gap.key === 'wrap_up') {
    return {
      speech: \`\${ack} Dann hab ich die wichtigen Infos zusammen. Soll ich zwei Optionen raussuchen?\`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'dest')`;
  const insert = `if (gap.key === 'wrap_up') {
    return {
      speech: \`\${ack} Dann hab ich die wichtigen Infos zusammen. Soll ich zwei Optionen raussuchen?\`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'keep_talking') {
    return {
      speech:
        addr === 'ihr'
          ? \`\${ack} Suche könnt ihr jederzeit starten — oder soll noch was präziser rein?\`
          : \`\${ack} Suche kannst du jederzeit starten — oder soll noch was präziser rein?\`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'dest')`;
  if (!s.includes(needle)) {
    console.error('needle not found');
    process.exit(1);
  }
  s = s.replace(needle, insert);
}
fs.writeFileSync(p, s);
console.log('ok', s.includes('isBriefComplete'), s.includes("gap.key === 'keep_talking'"));
