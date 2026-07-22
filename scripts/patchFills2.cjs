const fs = require('node:fs');
const path = 'C:/Users/larsf/Findus 2.0/scripts/generatePronunciationMap.mjs';
let src = fs.readFileSync(path, 'utf8');

// Ensure all uniqPad calls use MIN_CAT (5th arg)
src = src.replace(/uniqPad\(([^,]+,\s*[^,]+,\s*fill\w+,\s*(?:en|de|es|it|fr))\)/g, 'uniqPad($1, MIN_CAT)');
src = src.replace(/uniqPad\(([^,]+,\s*\[[^\]]+\],\s*fill\w+,\s*(?:en|de|es|it|fr))\)/g, 'uniqPad($1, MIN_CAT)');
// seed arrays with filter
src = src.replace(/uniqPad\('([^']+)',\s*(seedKulinarik\.filter\([^)]+\)),\s*(fill\w+),\s*(es|it|fr)\)(?!,\s*MIN_CAT)/g, "uniqPad('$1', $2, $3, $4, MIN_CAT)");
src = src.replace(/uniqPad\('at',\s*(\[[\s\S]*?\]),\s*fillAt,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('at', $1, fillAt, de, MIN_CAT)");
src = src.replace(/uniqPad\('geb',\s*(\[[\s\S]*?\]),\s*fillGebaeude,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('geb', $1, fillGebaeude, de, MIN_CAT)");
src = src.replace(/uniqPad\('ort',\s*(\[[\s\S]*?\]),\s*fillOrte,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('ort', $1, fillOrte, de, MIN_CAT)");
src = src.replace(/uniqPad\('stadt',\s*(\[[\s\S]*?\]),\s*fillStaedte,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('stadt', $1, fillStaedte, de, MIN_CAT)");
src = src.replace(/uniqPad\('fluss',\s*(\[[\s\S]*?\]),\s*fillFluesse,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('fluss', $1, fillFluesse, de, MIN_CAT)");
src = src.replace(/uniqPad\('berg',\s*(\[[\s\S]*?\]),\s*fillBerge,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('berg', $1, fillBerge, de, MIN_CAT)");
src = src.replace(/uniqPad\('name',\s*(\[[\s\S]*?\]),\s*fillNamen,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('name', $1, fillNamen, de, MIN_CAT)");
src = src.replace(/uniqPad\('hist',\s*(\[[\s\S]*?\]),\s*fillHistorisch,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('hist', $1, fillHistorisch, de, MIN_CAT)");
src = src.replace(/uniqPad\('alt',\s*(\[[\s\S]*?\]),\s*fillAltertuemlich,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('alt', $1, fillAltertuemlich, de, MIN_CAT)");
src = src.replace(/uniqPad\('umg',\s*(\[[\s\S]*?\]),\s*fillUmgang,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('umg', $1, fillUmgang, de, MIN_CAT)");
src = src.replace(/uniqPad\('dial',\s*(\[[\s\S]*?\]),\s*fillDialekte,\s*de\)(?!,\s*MIN_CAT)/g, "uniqPad('dial', $1, fillDialekte, de, MIN_CAT)");

src = src.replace('const MIN_CAT = 330;', 'const MIN_CAT = 335;');

const extra = {
fillEs: `tenerife sur tenerife norte lanzarote fuerteventura la palma la gomera el hierro formentera cabrera
ceuta melilla ribera del duero duero river duero valley rias baixas rias altas galician rias galician rias
costa del sol costa blanca costa brava costa verde costa da morte death coast death coast finisterre cape
finisterre lighthouse muxia sanctuary muxia sanctuary pedron stone pedron stone camino finisterre camino finisterre
santiago compostela cathedral botafumeiro botafumeiro swing pilgrim mass pilgrim mass pilgrim blessing
semana santa processions processions holy week holy week pasos pasos floats floats nazarenos nazarenos
feria de abril feria abril seville fair seville fair casetas casetas tents tents flamenco dress flamenco dress
alhambra generalife generalife gardens nazrid palaces nazrid palaces patio de los leones lions courtyard
lions courtyard court of lions court of lions alcazar seville alcazar seville mudejar mudejar architecture
mudejar architecture gothic quarter gothic quarter barrio gotico barrio gotico las ramblas las ramblas
la boqueria la boqueria market boqueria market sagrada familia sagrada familia basilica basilica sagrada
park guell park guell guell park guell park casa batllo casa batllo casa mila casa mila la pedrera la pedrera
`,

fillIt: `bergamo brescia cremona mantova modena parma piacenza reggio emilia rimini cesena forli forli
ancona pesaro urbino macerata ascoli piceno teramo pescara chieti l aquila l aquila campobasso isernia
potenza matera melfi cosenza crotone vibo valentia reggio calabria taranto brindisi foggia barletta
andria trani molfetta bisceglie monopoli polignano a mare polignano mare altamura altamura bread altamura bread
burano lace island lace island murano glass island murano glass island torcello torcello island torcello island
como bellagio varenna menaggio lecco sondrio bolzano merano merano merano bolzano alto adige sudtirol
suedtirol trento rovere rovere dolomites rovere dolomites cortina d ampezzo cortina ampezzo val gardena
val gardena val di fassa val di fassa val badia val badia alpe di siusi alpe di siusi seiser alm seiser alm
`,

fillFr: `metz nancy epinal vesoul besancon Belfort mulhouse colmar strasbourg reims epernay chalons chalons
chalonssurmarne chalons sur marne troyes auxerre sens joigny dijon beaune macon macon macon vienne
vienne isere grenoble chambery annecy annemasse annemasse geneva border geneva border saint etienne
clermont ferrand clermont ferrand limoges limoges perigueux perigueux bergerac bergerac sarlat sarlat
rocamadour rocamadour carcassonne carcassonne nimes nimes uzes uzes pont du gard pont du gard
aix les bains aix les bains evian evian evian water evian water thonon thonon les bains thonon les bains
`,

fillAt: `ebensee gmunden traunkirchen traunkirchen bad ischl bad ischl imperial town imperial town
gmunden lake traunsee traunsee attersee attersee mondsee mondsee wolfgangsee wolfgangsee faaker see
faaker see woerthersee woerthersee millstaetter see millstaetter see ossiacher see ossiacher see
weissensee weissensee weissensee lake weissensee lake bodensee bodensee lake constance lake constance
bregenz festival bregenz festival floating stage floating stage vorarlberg vorarlberg montafon montafon
silvretta silvretta arlberg arlberg lech zurs zurs st anton st anton ischgl ischgl soelden soelden
`,

fillGebaeude: `residence residence residenz residenz summer palace summer palace schlosspark schlosspark castle garden
castle garden orangery orangery orangery palace orangery palace winter palace winter palace winterpalais
winterpalais state room state room state rooms state rooms throne room throne room throne room ballroom ballroom
ballroom gallery wing gallery wing east wing east wing west wing west wing north wing north wing south wing
south wing wing wing trakt trakt corps de logis corps de logis stables stables marstall marstall coach house
coach house remise remise granary granary scheune scheune barn barn silo silo wind turbine wind turbine
`,

fillOrte: `business district business district geschaeftsviertel geschaeftsviertel industrial zone industrial zone
industriegebiet industriegebiet commercial strip commercial strip gewerbegebiet gewerbegebiet outlet mall
outlet mall factory outlet factory outlet outlet center outlet center shopping center shopping center
einkaufszentrum einkaufszentrum mall mall pedestrian precinct pedestrian precinct fussgaengerzone fussgaengerzone
`,

fillStaedte: `viseu coimbra aveiro braga guimaraes guimaraes evora evora faro faro funchal funchal ponta delgada
ponta delgada angra do heroismo angra heroismo horta horta praia praia mindelo mindelo bissau bissau
banjul banjul dakar dakar saint louis saint louis marrakech marrakech fes fes fez fez tangier tangier
casablanca casablanca rabat rabat tunis tunis sfax sfax sousse sousse algiers algiers oran oran constantine
`,

fillFluesse: `tigris euphrates jordan river jordan river sea of galilee sea of galilee dead sea dead sea
litani litani river litani river wadi wadi wadi rum wadi rum wadi musa wadi musa nile cataract nile cataract
blue nile falls blue nile falls victoria falls victoria falls zambezi gorge zambezi gorge okavango delta
okavango delta chobe chobe river chobe river limpopo limpopo river limpopo river orange river orange river
`,

fillBerge: `kilimanjaro mount kenya mount kenya mount meru mount meru rwenzori rwenzori mountains rwenzori mountains
atlas mountains atlas mountains toubkal toubkal mount toubkal mount toubkal high atlas high atlas
middle atlas middle atlas anti atlas anti atlas simien simien mountains simien mountains ethiopian highlands
ethiopian highlands drakensberg drakensberg table mountain table mountain cape town cape town flat top
flat top mount fuji mount fuji fuji san fuji san japanese alps japanese alps mount aso mount aso
`,

fillNamen: `agnes agnes adelaide adelaide albert albert alfred alfred arthur arthur august august bernhard bernhard
bruno bruno caspar caspar clemens clemens dennis dennis dominik dominik edgar edgar edmund edmund eduard eduard
emil emil erich erich ernst ernst eugen eugen fabian fabian florian florian fritz fritz georg georg gerald gerald
`,

fillHistorisch: `gotik gotik romanik romanik fruehgotik fruehgotik hochgotik hochgotik spaetgotik spaetgotik
manierismus manierismus impressionismus impressionismus naturalismus naturalismus realismus realismus
romantik romantik vormaerz vormaerz gruenderzeit gruenderzeit wilhelminische wilhelminische zeit wilhelminische zeit
`,

fillAltertuemlich: `wohlweislich wohlweislich derhalben derhalben deswegen deswegen daher daher demnach demnach
folglich folglich dementsprechend dementsprechend insofern insofern als als dass als ob gleichsam gleichwohl
gleichfalls gleichermaßen gleichermaßen hingegen hingegen indes indes indessen indessen inzwischen inzwischen
`,

fillUmgang: `stimmt schon stimmt schon passt passt passt doch passt doch geht schon geht schon geht klar geht klar
alles paletti alles paletti alles roger alles roger alles astrein alles astrein alles fein alles fein
alles cool alles cool alles easy alles easy alles entspannt alles entspannt alles fit alles fit
`,

fillDialekte: `alltag alltag platt alltag platt alltag schnacken schnacken schnack schnack plaudern plaudern
quatschen quatschen schwafeln schwafeln labern labern quatschen quatschen schnacken schnacken plaudern plaudern
`,

};

for (const [name, add] of Object.entries(extra)) {
  const re = new RegExp(`(const ${name} = words\\(\`)([\\s\\S]*?)(\`\\);)`);
  src = src.replace(re, (_, a, body, c) => {
    const merged = (body.trim() + '\n' + add.trim()).trim();
    return `${a}${merged}${c}`;
  });
}

fs.writeFileSync(path, src);
console.log('fixed MIN_CAT on all + expanded short lists');
