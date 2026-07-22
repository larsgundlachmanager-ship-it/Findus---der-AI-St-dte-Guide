const fs = require('node:fs');
const path = 'C:/Users/larsf/Findus 2.0/scripts/generatePronunciationMap.mjs';
let src = fs.readFileSync(path, 'utf8');

function append(name, add) {
  const re = new RegExp(`(const ${name} = words\\(\`)([\\s\\S]*?)(\`\\);)`);
  src = src.replace(re, (_, a, body, c) => `${a}${(body.trim() + '\n' + add.trim()).trim()}${c}`);
}

append('fillEs', `cuenca cuenca hanging houses hanging houses hanging houses cuenca casas colgadas casas colgadas
merida merida roman theatre roman theatre roman bridge roman bridge alcantara bridge alcantara bridge
caceres caceres old town caceres old town trujillo trujillo pizarro birthplace pizarro birthplace
plasencia plasencia monastery route monastery route guadalupe guadalupe royal monastery royal monastery
`);

append('fillKulinarik', `panettone pandoro colomba colomba pasquale torrone torrone nougat nougat cannoli cannoli
cassata cassata arancini arancini suppli suppli saltimbocca saltimbocca ossobuco ossobuco vitello vitello
`);

append('fillFr', `angers angers nantes nantes brest brest quimper quimper vannes vannes lorient lorient
saint nazaire saint nazaire la rochelle la rochelle rochefort rochefort cognac cognac town cognac town
jarnac jarnac segonzac segonzac angouleme angouleme poitiers poitiers limoges limoges clermont clermont
vichy vichy spa vichy spa moulins moulins nevers nevers auxerre auxerre sens sens joigny joigny
melun melun fontainebleau fontainebleau palace fontainebleau palace versailles versailles palace versailles palace
saint cloud saint cloud rueil rueil malmaison malmaison saint germain saint germain en laye saint germain laye
poissy poissy conflans conflans confluence confluence confluence seine confluence seine
meaux meaux brie brie cheese brie cheese coulommiers coulommiers camembert camembert pont l eveque pont leveque
livarot livarot neufchatel neufchatel roquefort roquefort bleu bleu cheese bleu cheese comte comte cheese
comte cheese reblochon reblochon tomme tomme cheese tomme cheese raclette cheese raclette cheese fondue savoyarde
fondue savoyarde tartiflette tartiflette diots diots saucisson saucisson rillettes rillettes pate pate campagne
pate campagne terrine terrine confit confit duck confit duck magret magret foie foie gras foie gras
`);

append('fillAt', `freistadt freistadt walled town walled town scharding scharding braunau braunau am inn braunau inn
ried im innkreis ried innkreis grieskirchen grieskirchen wels wels steyr steyr enns enns town enns town
amstetten amstetten melk melk danube danube bend danube bend wachau valley wachau valley apricot trail
apricot trail marillenstrasse marillenstrasse apricot street apricot street durnstein durnstein castle ruins
castle ruins richard lionheart prison richard lionheart prison kuenringer kuenringer castle kuenringer castle
spitz an der donau spitz donau boat trip boat trip wachau boat wachau boat melk abbey tour melk abbey tour
`);

append('fillGebaeude', `gate tower gate tower torwacht turm torwacht turm barbican barbican barbakane barbakane
portcullis portcullis fallgatter fallgatter machicolation machicolation schiessscharte schiessscharte
crenelation crenelation zinnen zinnen battlement battlement brustwehr brustwehr parapet parapet bruestung bruestung
watchtower watchtower wachturm wachturm signal tower signal tower signalturm signalturm fire tower fire tower
feuerwachturm feuerwachturm water tower water tower wasserturm wasserturm grain elevator grain elevator
`);

append('fillOrte', `old port old port alter hafen alter hafen fishing harbor fishing harbor fischereihafen fischereihafen
commercial harbor commercial harbor handelshafen handelshafen cruise terminal cruise terminal kreuzfahrtterminal
kreuzfahrtterminal ferry terminal ferry terminal faehrterminal faehrterminal bus terminal bus terminal
busbahnhof busbahnhof tram stop tram stop strassenbahnhaltestelle strassenbahnhaltestelle metro station metro station
u bahn station u bahn station s bahn station s bahn station regional stop regional stop haltepunkt haltepunkt
`);

append('fillStaedte', `santander santander oviedo oviedo gijon gijon la coruna la coruna vigo vigo pontevedra pontevedra
ourense ourense lugo lugo leon leon burgos burgos valladolid valladolid palencia palencia zamora zamora
avila avila segovia segovia soria soria guadalajara guadalajara cuenca cuenca albacete albacete ciudad real
ciudad real toledo toledo talavera talavera merida merida badajoz badajoz caceres caceres plasencia plasencia
`);

append('fillFluesse', `inn inn river inn river lech lech river lech river isar isar river isar river salzach salzach river
salzach river traun traun river traun river enns enns river enns river mur mur river mur river drau drau river
drau river save save river save river sava sava river sava river krka krka river krka river soca soca river soca river
`);

append('fillBerge', `hohe tauern hohe tauern national park national park grossglockner grossglockner road grossglockner road
kaiser franz josefs hoehe kaiser franz josefs hoehe edelweiss peak edelweiss peak pasterze glacier pasterze glacier
grossvenediger grossvenediger grossglockner grossglockner highest peak highest peak austria highest peak austria
`);

append('fillNamen', `ignaz ignaz ilse ilse ilona ilona inga inga ingeborg ingeborg ingo ingo ingrid ingrid irene irene
irina irina iris iris irma irma irmgard irmgard isabel isabel isabella isabella isabelle isabelle isidor isidor
`);

append('fillHistorisch', `absolutismus absolutismus konstitutionalismus konstitutionalismus parlamentarismus parlamentarismus
demokratie demokratie republik republik monarchie monarchie oligarchie oligarchie aristokratie aristokratie
theokratie theokratie totalitarismus totalitarismus autoritarismus autoritarismus faschismus faschismus
nationalsozialismus nationalsozialismus stalinismus stalinismus maoismus maoismus
`);

append('fillAltertuemlich', `allenthalben allenthalben allerwarts allerwarts allerorten allerorten allerseits allerseits
allerlei allerlei allerhand allerhand allerorten allerorten allerwarts allerwarts allenthalben allenthalben
`);

append('fillUmgang', `kein stress kein stress null stress null stress voll stress voll stress kein thema kein thema
null thema null thema voll thema voll thema kein drama kein drama null drama null drama voll drama voll drama
`);

append('fillDialekte', `allemannisch allemanisch schwyzerdütsch schwyzerduetsch baseldeutsch baseldeutsch bern deutsch bern deutsch
walliserdeutsch walliserdeutsch viennese viennese wienerisch wienerisch berliner berliner koelsch koelsch
saxon saxon saechsisch saechsisch bavarian bavarian bayerisch bayerisch franconian franconian fraenkisch fraenkisch
`);

fs.writeFileSync(path, src);
const words = (s) => [...new Set(s.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 1))];
const re = /const (fill\w+) = words\(`([\s\S]*?)`\);/g;
let m; const counts = {};
while ((m = re.exec(src))) counts[m[1]] = words(m[2]).length;
for (const [k,v] of Object.entries(counts).sort()) console.log(k, v, v>=350?'OK':'SHORT');
