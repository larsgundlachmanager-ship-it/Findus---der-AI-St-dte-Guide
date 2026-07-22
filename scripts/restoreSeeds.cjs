const fs=require("fs");
const p="C:/Users/larsf/Findus 2.0/scripts/generatePronunciationMap.mjs";
let s=fs.readFileSync(p,"utf8");
if (s.includes("const seedJugend")) { console.log("seeds ok"); process.exit(0);} 
const G="\u0261";
const e=(w,ipa)=>`  e(${JSON.stringify(w)}, ${JSON.stringify(ipa)}),`;
const en=(w)=>{let x=String(w).toLowerCase().replace(/sch/g,"?").replace(/tion/g,"??n").replace(/g/g,G);return x;};
const de=(w)=>{let x=String(w).toLowerCase().replace(/sch/g,"?").replace(/g/g,G);return x;};
function parseFill(name){const m=s.match(new RegExp("const "+name+" = words\\(([\s\S]*?)\\);")); if(!m)return []; return JSON.parse(m[1]).split(/\s+/).filter(Boolean);}
const j=parseFill("fillJugend").slice(0,150);
const k=parseFill("fillKulinarik").slice(0,90);
const seeds=`\nconst seedJugend = [\n${j.map(w=>e(w,en(w))).join("\n")}\n];\n\nconst seedKulinarik = [\n${k.map(w=>e(w,en(w))).join("\n")}\n];\n\n`;
s=s.replace("\nconst words =", seeds+"const words =");
fs.writeFileSync(p,s);
console.log("restored seeds",j.length,k.length);
