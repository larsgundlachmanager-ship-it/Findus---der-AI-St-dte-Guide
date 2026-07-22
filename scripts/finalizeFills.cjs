const fs = require("node:fs");
const path = require("node:path");
const mjsPath = path.join(__dirname, "generatePronunciationMap.mjs");
let src = fs.readFileSync(mjsPath, "utf8");
const wordsFn = (s) => [...new Set(s.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 1))];
src = src.replace(/const MIN_CAT = \d+;/, "const MIN_CAT = 342;");
const map = { fillAt:"at.txt", fillGebaeude:"gebaeude.txt", fillOrte:"orte.txt", fillStaedte:"staedte.txt", fillFluesse:"fluesse.txt", fillBerge:"berge.txt", fillNamen:"namen.txt", fillHistorisch:"historisch.txt", fillAltertuemlich:"altertuemlich.txt", fillUmgang:"umgang.txt", fillDialekte:"dialekte.txt" };
for (const [fillName, file] of Object.entries(map)) {
  const extraPath = path.join(__dirname, "fillExtras", file);
  if (!fs.existsSync(extraPath)) continue;
  const extra = fs.readFileSync(extraPath, "utf8");
  const re = new RegExp("const " + fillName + " = words\\(`([\\s\\S]*?)`\\);");
  const m = src.match(re);
  if (!m) continue;
  const merged = [...new Set([...wordsFn(m[1]), ...wordsFn(extra)])].join(" ");
  src = src.replace(re, "const " + fillName + " = words(`" + merged + "`);");
}
fs.writeFileSync(mjsPath, src);
const reAll = /const (fill\\w+) = words\\(`([\\s\\S]*?)`\\);/g;
let m; let short = 0;
while ((m = reAll.exec(src))) { const n = wordsFn(m[2]).length; console.log(m[1], n, n >= 350 ? "OK" : "SHORT"); if (n < 350) short++; }
console.log("short", short);
