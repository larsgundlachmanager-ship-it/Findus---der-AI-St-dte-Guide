const fs = require('fs');
const p = 'src/reisebuero/parseBriefSlots.ts';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  /function wantsCheapDrinks\(t: string\): boolean \{\n  return \/\\b\(günstig\(\?:e\|es\|en\)\?\\s\+bier\|bier\(\?:preis\(\?:e\)\?\)\?\\s\*\(\?:günstig\|guenstig\|billig\)\|billig\(\?:es\|e\)\?\\s\+bier\|günstige\\s\+\(\?:getränke\|drinks\)\|guenstige\\s\+\(\?:getränke\|drinks\|bier\)\)\\b\/iu\.test\(\n    t,\n  \);\n\}/,
  `function wantsCheapDrinks(t: string): boolean {
  return /\\b(günstig(?:e|es|en)?\\s+bier(?:preis(?:e)?)?|guenstig(?:e|es|en)?\\s+bier(?:preis(?:e)?)?|bier(?:preis(?:e)?)?\\s*(?:günstig|guenstig|billig)|billig(?:es|e)?\\s+bier|günstige\\s+(?:getränke|drinks)|guenstige\\s+(?:getränke|drinks|bier))\\b/iu.test(
    t,
  );
}`,
);
fs.writeFileSync(p + '.tmp', s);
fs.renameSync(p + '.tmp', p);
console.log('cheap drinks regex', s.includes('bier(?:preis(?:e)?)?'));
