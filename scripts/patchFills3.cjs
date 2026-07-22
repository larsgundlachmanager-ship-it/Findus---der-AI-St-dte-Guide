const fs = require('node:fs');
const path = 'C:/Users/larsf/Findus 2.0/scripts/generatePronunciationMap.mjs';
let src = fs.readFileSync(path, 'utf8');

const bulk = {
fillIt: `cagliari olbia olbia alghero alghero nuoro nuoro oristano oristano sassari sassari iglesias iglesias
olbia costa smeralda costa smeralda emerald coast emerald coast porto cervo porto cervo porto rotundo
porto rotundo la maddalena la maddalena archipelago archipelago caprera caprera island caprera island
san teodoro san teodoro cala goloritze cala goloritze cala luna cala luna cala mariolu cala mariolu
selvaggio blu selvaggio blu blue trail blue trail gorropu gorge gorropu gorge supramonte supramonte
barbagia barbagia region barbagia region nuraghe nuraghe nuraghe su nuraxi nuraghe su nuraxi
tharros tharros ancient site ancient site su nuraxi su nuraxi nuragic nuragic civilization nuragic civilization
etruscan etruscan etruscan sites etruscan sites volterra volterra volterra alabaster volterra alabaster
san gimignano san gimignano medieval towers medieval towers montepulciano montepulciano montalcino montalcino
brunello brunello di montalcino brunello montalcino chianti classico chianti classico chianti rufina
chianti rufina vino nobile vino nobile di montepulciano vino nobile montepulciano orvieto classico orvieto classico
frascati frascati castelli romani castelli romani roman hills roman hills tivoli gardens tivoli gardens
hadrian villa tivoli villa adriana tivoli eremo eremo delle carceri eremo carceri assisi assisi basilica
basilica san francesco basilica san francesco perugia perugia umbria jazz umbria jazz festival umbria jazz
spoleto spoleto festival dei due mondi festival two worlds festival two worlds norcia norcia norcia ham
norcia ham cascia cascia saint rita saint rita saint rita sanctuary saint rita sanctuary`,

fillFr: `rouen rouen cathedral rouen cathedral impressionism impressionism claude monet claude monet
giverny giverny monet garden monet garden honfleur honfleur etretat etretat cliffs etretat cliffs
deauville deauville trouville trouville cabourg cabourg bayeux bayeux tapestry bayeux tapestry
mont saint michel mont saint michel saint malo saint malo corsica corsica ajaccio ajaccio bastia bastia
bonifacio bonifacio calvi calvi porto vecchio porto vecchio calanques calanques cassis cassis calanques
luberon luberon gordes gordes roussillon roussillon ochre village ochre village avignon avignon palais papes
palais papes festival avignon festival avignon bridge pont avignon pont avignon chateauneuf pape chateauneuf pape
beaune beaune burgundy route route grands crus route grands crus chablis chablis meursault meursault
chamonix chamonix mont blanc mont blanc aiguille midi aiguille midi mer de glace mer de glace
annecy annecy lake annecy lake annecy old town annecy old town strasbourg strasbourg petite france petite france
colmar colmar alsace wine alsace wine route riquewihr riquewihr eguisheim eguisheim reims reims cathedral
reims cathedral champagne houses champagne houses epernay epernay avenue champagne avenue champagne
bordeaux bordeaux saint emilion saint emilion medoc medoc chateau margaux chateau margaux`,

fillAt: `semmering semmering railway semmering railway semmering pass semmering pass mariazell mariazell
pilgrimage basilica pilgrimage basilica stift melk stift melk melk abbey melk abbey wachau apricot wachau apricot
duernstein duernstein richard lionheart richard lionheart spitz spitz an der donau spitz donau
krems krems art mile krems art mile gars am kamp gars kamp kamptal wine kamptal wine langenlois langenlois
zweigelt country zweigelt country blaufraenkisch country blaufraenkisch country thermenregion styria thermenregion
bad blumau bad blumau friedensreich friedensreich hundertwasser hundertwasser rogers rogers bad blumau
graz schlossberg schlossberg clock tower clock tower uhrturm uhrturm eggenberg eggenberg palace eggenberg palace
murtal murtal red bull ring red bull ring spielberg spielberg formula one formula one race track
`,

fillGebaeude: `concert hall concert hall konzertsaal konzertsaal recital hall recital hall kleiner saal kleiner saal
opera house opera house opernhaus opernhaus music hall music hall musiktheater musiktheater playhouse playhouse
schauspielhaus schauspielhaus comedy theater comedy theater komoedie komoedie cabaret cabaret kabarett kabarett
variety theater variety theater variete variete circus circus zirkus zirkus circus tent circus tent zirkuszelt
zirkuszelt fairground fairground jahrmarkt jahrmarkt exhibition hall exhibition hall messehalle messehalle
convention center convention center kongresszentrum kongresszentrum congress hall congress hall kongresshalle
kongresshalle lecture hall lecture hall hoersaal hoersaal seminar room seminar room seminarraum seminarraum
`,

fillOrte: `suburb suburb vorort vorort commuter belt commuter belt pendlergebiet pendlergebiet bedroom community
bedroom community schlafstadt schlafstadt satellite town satellite town satellitenstadt satellitenstadt
new town new town neustadt neustadt planned community planned community planstadt planstadt garden city garden city
gartenstadt gartenstadt eco district eco district oekostadt oekostadt smart city smart city smart city quarter
smart city quarter innovation hub innovation hub innovationszentrum innovationszentrum tech campus tech campus
tech campus gruenderzentrum gruenderzentrum startup hub startup hub startup hub accelerator accelerator accelerator
`,

fillStaedte: `belgrade belgrade zagreb zagreb sarajevo sarajevo skopje skopje tirana tirana podgorica podgorica
pristina pristina chisinau chisinau kyiv kyiv lviv lviv odessa odessa kharkiv kharkiv minsk minsk
minsk grodno grodno brest brest gomel gomel vitebsk vitebsk tbilisi tbilisi yerevan yerevan baku baku
astana astana almaty almaty tashkent tashkent samarkand samarkand bukhara bukhara khiva khiva`,

fillFluesse: `oder oder river oder river neisse neisse river neisse river spree spree river spree river havel havel river
havel river elbe elbe river elbe river mulde mulde river mulde river saale saale river saale river
weser weser river weser river ems ems river ems river ruhr ruhr river ruhr river lippe lippe river lippe river
`,

fillBerge: `piz bernina piz bernina piz palu piz palu piz corvatsch piz corvatsch piz nair piz nair piz lagalb piz lagalb
piz glüschaint piz glueschaint piz kesch piz kesch piz ela piz ela piz daint piz daint piz sesvenna piz sesvenna
piz umur piz umur piz triaz piz triaz piz da las blaas piz da las blaas piz da l'acqua piz da lacqua
`,

fillNamen: `gotthold gotthold gottfried gottfried gottlieb gottlieb gottlob gottlob hartmut hartmut hartwig hartwig
hartwin hartwin hartmann hartmann heinz heinz heinrich heinrich helga helga helmut helmut herbert herbert
hermann hermann herta herta hilda hilda hildegard hildegard hilde hilde hubert hubert hugo hugo`,

fillHistorisch: `aufklaerung aufklaerung enlightenment enlightenment fruehaufklaerung fruehaufklaerung hochaufklaerung hochaufklaerung
skeptizismus skepsis rationalismus rationalismus empirismus empirismus idealismus idealismus materialismus materialismus
positivismus positivismus marxismus marxismus sozialismus sozialismus kommunismus kommunismus kapitalismus kapitalismus
`,

fillAltertuemlich: `allwohin allwohin allwärts allwaerts allzeit allzeit allzu allzu allzumal allzumal allzuviel allzuviel
allzuwenig allzuwenig allzugross allzugross allzuklein allzuklein allzuviel allzuviel allzuwenig allzuwenig
`,

fillUmgang: `halt mal halt mal warte mal warte mal moment mal moment mal sekunde mal sekunde mal kurz mal kurz mal
schnell mal schnell mal eben mal eben mal fix mal fix mal zack mal zack mal`,

fillDialekte: `nordfriesisch nordfriesisch ostfriesisch ostfriesisch saterfriesisch saterfriesisch low saxon low saxon
low german low german eastphalian eastphalian westphalian westphalian east prussian east prussian`,

};

for (const [name, add] of Object.entries(bulk)) {
  const re = new RegExp(`(const ${name} = words\\(\`)([\\s\\S]*?)(\`\\);)`);
  src = src.replace(re, (_, a, body, c) => `${a}${(body.trim() + '\n' + add.trim()).trim()}${c}`);
}

fs.writeFileSync(path, src);
