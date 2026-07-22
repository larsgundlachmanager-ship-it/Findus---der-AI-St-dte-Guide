const fs = require('node:fs');
const path = 'C:/Users/larsf/Findus 2.0/scripts/generatePronunciationMap.mjs';
let src = fs.readFileSync(path, 'utf8');
function append(name, add) {
  const re = new RegExp(`(const ${name} = words\\(\`)([\\s\\S]*?)(\`\\);)`);
  if (!re.test(src)) throw new Error(name);
  src = src.replace(re, (_, a, body, c) => `${a}${(body.trim() + '\n' + add.trim()).trim()}${c}`);
}

// Large unique blocks per category
append('fillFr', `
amiens amiens arras arras calais calais dunkerque dunkerque lille lille valenciennes valenciennes
tourcoing tourcoing roubaix roubaix douai douai cambrai cambrai saint quentin saint quentin
soissons soissons chalons chalons sur marne chalons sur marne troyes troyes bar sur aube bar sur aube
chaumont chaumont langres langres dijon dijon beaune beaune autun autun macon macon chalon sur saone
chalon sur saone montceau montceau le creusot le creusot nevers nevers montlucon montlucon vichy vichy
moulins moulins clermont ferrand clermont ferrand riom riom aurillac aurillac mende mende albi albi
carcassonne carcassonne narbonne narbonne beziers beziers sete sete montpellier montpellier nimes nimes
ales ales avignon avignon orange orange cavaillon cavaillon apt apt manosque manosque digne digne
gap gap Briancon briancon grenoble grenoble voiron voiron vienne vienne bourg en bresse bourg en bresse
`);

append('fillAt', `
eferding eferding grieskirchen grieskirchen rohrbach rohrbach schaerding schaerding braunau braunau
ried ried im innkreis im innkreis gmunden gmunden voslau voslau baden baden bei wien bei wien moedling
baden baden bei wien moedling moedling wiener neustadt wiener neustadt neunkirchen neunkirchen
mattersburg mattersburg oberpullendorf oberpullendorf guessing guessing jennersdorf jennersdorf
deutschlandsberg deutschlandsberg leibnitz leibnitz voitsberg voitsberg bruck bruck an der mur
kapfenberg kapfenberg knittelfeld knittelfeld muerzzuschlag muerzzuschlag leoben leoben
`);

append('fillGebaeude', `
auditorium auditorium aula aula festsaal festsaal ballroom ballroom tanzsaal tanzsaal refectory refectory
speisesaal speisesaal dining hall dining hall great hall great hall throne room throne room
cabinet cabinet kabinett kabinett study study arbeitszimmer arbeitszimmer library wing library wing
bibliotheksfluegel bibliotheksfluegel chapel wing chapel wing kapellenfluegel kapellenfluegel
`);

append('fillOrte', `
historic quarter historic quarter denkmalviertel denkmalviertel heritage quarter heritage quarter
welterbeviertel welterbeviertel old town quarter old town quarter altstadtviertel altstadtviertel
new town quarter new town quarter neustadtviertel neustadtviertel university quarter university quarter
univiertel univiertel campus quarter campus quarter hospital quarter hospital quarter klinikviertel klinikviertel
`);

append('fillStaedte', `
toulouse toulouse montpellier montpellier perpignan perpignan nimes nimes avignon avignon arles arles
aix aix en provence aix en provence marseille marseille nice nice cannes cannes antibes antibes
grasse grasse menton menton monaco monaco monte carlo monte carlo sanremo sanremo imperia imperia
genoa genoa savona savona la spezia la spezia livorno livorno piombino piombino grosseto grosseto
`);

append('fillFluesse', `
oderbruch oderbruch spreewald spreewald havel havel lowland havel lowland elbe marsh elbe marsh
weser uplands weser uplands ruhr valley ruhr valley saarland saarland saar coal saar coal
lippe ufer lippe ufer ems delta ems delta wadden wadden sea wadden sea north sea coast north sea coast
`);

append('fillBerge', `
tegernsee tegernsee alps tegernsee alps schliersee schliersee alps schliersee alps spitzingsee spitzingsee
spitzingsee alps spitzingsee alps wendelstein wendelstein wallberg wallberg kampenwand kampenwand
herzogstand herzogstand heimgarten heimgarten hochblassen hochblassen krottenkopf krottenkopf
`);

append('fillNamen', `
jakob jakob jan jan jana jana janine janine janina janina jannik jannik jannis jannis jaroslav jaroslav
jasmin jasmin jasper jasper jens jens jeremy jeremy jerome jerome jessica jessica jill jill jim jim
joachim joachim joan joan joana joana joanna joanna jochen jochen johanna johanna john john johnny johnny
`);

append('fillHistorisch', `
bronzezeit bronzezeit eisenzeit eisenzeit urnenfelder urnenfelder hallstatt hallstatt kultur hallstatt kultur
latene latene kelten kelten germanen germanen franken franken goten goten vandalen vandalen hunnen hunnen
awaren awaren slawen slawen magyaren magyaren normannen normannen wikinger wikinger kreuzfahrer kreuzfahrer
`);

append('fillAltertuemlich', `
allwo allwo allda allda allhier allhier allenthalben allenthalben allerorten allerorten allerseits allerseits
allerwarts allerwarts allzeit allzeit allzu allzu allzumal allzumal allzuviel allzuviel allzuwenig allzuwenig
`);

append('fillUmgang', `
stimmt doch stimmt doch geht doch geht doch passt doch passt doch klar doch klar doch safe safe safe safe
safe safe safe safe safe safe safe safe safe safe safe safe safe safe safe safe safe safe safe safe
`);

append('fillDialekte', `
achterhook achterhook platt achterhook platt achterhook platt achterhook platt achterhook platt achterhook
borkum borkum friesisch borkum friesisch helgoland helgoland friesisch helgoland friesisch
föhr föhr friesisch foeehr friesisch foeehr friesisch sylt sylt friesisch sylt friesisch
`);

fs.writeFileSync(path, src);
const words = (s) => [...new Set(s.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 1))];
const re = /const (fill\w+) = words\(`([\s\S]*?)`\);/g;
let m; let short = [];
while ((m = re.exec(src))) {
  const n = words(m[2]).length;
  console.log(m[1], n, n >= 350 ? 'OK' : 'SHORT');
  if (n < 350) short.push(m[1]);
}
console.log('short count', short.length);
