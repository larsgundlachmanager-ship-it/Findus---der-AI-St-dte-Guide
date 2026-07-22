const fs=require("fs");
const p="C:/Users/larsf/Findus 2.0/scripts/generatePronunciationMap.mjs";
let s=fs.readFileSync(p,"utf8");
s=s.replace(/dieci nove\);(\s*\n\s*const fillNamen)/,"dieci nove`);$1");
s=s.replace(/nikolaus nikola\);(\s*\n\s*const fillHistorisch)/,"nikolaus nikola`);$1");
fs.writeFileSync(p,s);
console.log("patched closers");
