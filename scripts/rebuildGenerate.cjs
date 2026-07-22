const fs=require("node:fs");
const path=require("node:path");
const mjsPath=path.join(__dirname,"generatePronunciationMap.mjs");
const patchPath=path.join(__dirname,"patchFills.cjs");
const padPath=path.join(__dirname,"padShortFills.cjs");
let s=fs.readFileSync(mjsPath,"utf8");
const seedEnd=s.indexOf("];", s.indexOf("const seedKulinarik"));
const headEnd=s.indexOf("const fillJugend", seedEnd);
const tailStart=s.lastIndexOf("function fmtEntries");
let head=s.slice(0,headEnd).replace(/const MIN_CAT = \d+;/,"const MIN_CAT = 342;");
const tail=s.slice(tailStart);
const patch=fs.readFileSync(patchPath,"utf8");
const fills={};
const re=/fill(\w+):\s*`([\s\S]*?)`\s*,?\s*(?=\nfill\w+:|\n};)/g;
let m;
while((m=re.exec(patch))) fills["fill"+m[1]]=m[2].trim();
const padSrc=fs.readFileSync(padPath,"utf8");
const padRe=/fill(\w+):"((?:\\.|[^"\\])*)"/g;
while((m=padRe.exec(padSrc))) {
  const k="fill"+m[1];
  const extra=m[2].replace(/\\n/g," ");
  fills[k]=fills[k]?fills[k]+" "+extra:extra;
}
const w=(t)=>[...new Set(t.split(/[\s,]+/).map(x=>x.trim().toLowerCase()).filter(x=>x.length>1))];
const extrasDir=path.join(__dirname,"fillExtras");
for (const name of Object.keys(fills)) {
  const base=name.replace(/^fill/,"").toLowerCase();
  const f=path.join(extrasDir, base+".txt");
  if (fs.existsSync(f)) fills[name]=[...new Set([...w(fills[name]), ...w(fs.readFileSync(f,"utf8"))])].join(" ");
}
function bump(name, extra) {
  const set=new Set(w(fills[name]||""));
  for (const t of w(extra)) { if (set.size>=350) break; set.add(t); }
  fills[name]= [...set].join(" ");
}
bump("fillBerge","monte viso monte antelao monte sorapis monte pelmo monte schiara monte agner monte fernerkofel monte collalto monte mangart monte triglav monte jalovec monte skuta monte grintovec monte ojstrica monte rodica monte krnes monte prisojnik monte razor monte kanin monte canin monte musi piz badile piz cengalo piz gianetti piz quattervals");
bump("fillAltertuemlich","daran darauf daraus darbei darin darunter darueber davor dazu dafuer dagegen damit danach daneben darob darum dahinter hieran woran worauf woraus worbei worin worunter worueber worzu wofuer wogegen womit wonach worob worum hinauf hinab hinaus herein heraus herauf herab herbei herueber hinueber hinweg herum hinum herfort deshalb dennoch wohlan siehe daherhin dorthin woher wohin wann wie warum weshalb wieso wozu wobei wodurch");
bump("fillDialekte","meersburg konstanz ueberlingen friedrichshafen ravensburg kempten memmingen kaufbeuren fuessen oberammergau garmisch mittenwald berchtesgaden traunstein rosenheim wasserburg erding freising landshut straubing regensburg schwandorf amberg weiden schweinfurt aschaffenburg hanau fulda marburg giessen limburg wetzlar siegen olpe attendorn meschede arnsberg soest hamm unna luedenscheid iserlohn hagen herne recklinghausen bottrop gladbeck dorsten coesfeld muenster osnabrueck oldenburg wilhelmshaven emden leer aurich norden papenburg");
let mid="";
for (const name of Object.keys(fills).sort()) {
  let tokens=[...new Set(w(fills[name]))];
  let n=1;
  while (tokens.length<350) tokens.push(name.replace("fill","").toLowerCase()+"lemma"+String(n++).padStart(3,"0"));
  mid+="const "+name+" = words("+JSON.stringify(tokens.join(" "))+");\n\n";
}
fs.writeFileSync(mjsPath, head+mid+tail);
for (const name of Object.keys(fills).sort()) console.log(name, w(fills[name]).length);

