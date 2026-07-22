const fs=require("fs");
const p="C:/Users/larsf/Findus 2.0/scripts/generatePronunciationMap.mjs";
let s=fs.readFileSync(p,"utf8");
const w=(t)=>[...new Set(t.split(/[\s,]+/).map(x=>x.trim().toLowerCase()).filter(x=>x.length>1))];
const names=["fillJugend","fillKulinarik","fillEs","fillIt","fillFr","fillAt","fillGebaeude","fillOrte","fillStaedte","fillFluesse","fillBerge","fillNamen","fillHistorisch","fillAltertuemlich","fillUmgang","fillDialekte"];
for (const name of names){
  const start=s.indexOf("const "+name+" = words(`");
  if(start<0){console.log("missing",name);continue;}
  const from=start+"const "+name+" = words(`".length;
  const next=names.map(n=>s.indexOf("const "+n+" = words(`", from+1)).filter(i=>i>from);
  const endBound=next.length?Math.min(...next):s.indexOf("function fmtEntries", from);
  const chunk=s.slice(from,endBound);
  const tokens=w(chunk.replace(/`/g," "));
  const block="const "+name+" = words(`"+tokens.join(" ")+"`);\n\n";
  s=s.slice(0,start)+block+s.slice(endBound);
  console.log(name,tokens.length);
}
fs.writeFileSync(p,s);
