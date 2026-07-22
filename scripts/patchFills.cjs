const fs = require('node:fs');
const path = 'C:/Users/larsf/Findus 2.0/scripts/generatePronunciationMap.mjs';
let src = fs.readFileSync(path, 'utf8');

const MIN_CAT = 330;

const fills = {
fillJugend: `yeet mid bet fire extra basic savage iconic awkward chill cool random trend meme viral
selfie story reel podcast playlist streaming content hashtag influencer drip clout vibe mood
aesthetic era core hype squad crew bestie fam bro dude sis king queen icon legend anime manga
waifu otaku weeb cosplay fanfic shipping spoiler binge crush swipe date ghost simp stan ratio
salty snatch boujee bussin flex match highlight location checkin checkout online wifi email
app shop food street park meetup workshop briefing deadline feedback team boss job weekend
lifestyle wellness brunch cocktail smoothie startup coworking campus arena stadium hotspot
landmark sightseeing downtown uptown midtown rooftop lounge club pub gallery boutique spa
nightlife takeaway souvenir screenshot doomscroll brainrot discourse cancelled woke aura cooked
girlboss gaslight gatekeep yapping pickme niceguy mansplain trauma infodump plottwist storytime
skillissue cope seethe goated unhinged feral chaotic periodt gyatt mewing looksmaxxing fanum
ohio locked rental sayless bigmood hitsdifferent assignment ate crumbs maincharacter softlaunch
hardlaunch glowup situationship redflag greenflag vibecheck fitchcheck dripcheck ootd serving
mothering hypebeast hyped innit bruv blud homie bias fancam ult kpop husbando skibidi
sigma delulu goat fomo yolo cap npc ick tea slay rizz lowkey highkey ghosting flexing
touchgrass rentfree understood period queen savage toxic iconic cringy based sus lit vibing
stanning ratioed clipped muted blocked reported shadowban algorithm feed timeline explorepage
forYouPage duet stitch remix filter sticker emoji reaction subscribe follow unfollow block
mute pin archive save repost quote tweet thread spaces livestream vlog unboxing haul
grwm routine skincare makeup tutorial review unboxing collab sponsorship affiliate linktree
bio caption alt text verified badge bluecheck monetize paywall premium subscription tier
discord twitch kick subathon emote pogchamp copium hopium ratio touch grass chronically
delulu solulu tradwife girlmath boymath romanempire beige flag beige mom clean girl
old money quiet luxury mob wife mobwife coastal grandmother tomato girl strawberry girl
cottagecore goblincore darkacademia lightacademia normcore gorpcore blokecore coquette
coastal cowgirl y2k grunge emo scene kid skater punk goth alt eboy egirl softboy
hard launch soft launch situationship breadcrumbing ghosted zoned friendzoned leftonread
seenzone replyguy maincharacterenergy plotarmor sidecharacter energy check vibe shift
ick factor green flag red flag beige flag ouch corecore brain rot terminally online
skibidi toilet fanum tax mewing jawline looks maxxing mogging demogorgon stranger things
minecraft fortnite roblox valorant league gacha gachapon lootbox battlepass season pass
speedrun glitch meta build nerf buff patch notes changelog hotfix beta alpha early access
dlc expansion pack crossover collab event limited edition drop restock soldout scalper
reseller thrift flip flipper side hustle hustle grindset sigma grindset alpha male beta male
ladder climbing corporate girlboss lean in girl dinner girl math delulu is the solulu`,

fillKulinarik: `tapas bruschetta gnocchi espresso paella croissant baguette ramen sushi sashimi tempura
risotto tiramisu prosciutto mozzarella parmesan pesto carbonara bolognese lasagna focaccia
ciabatta antipatti carpaccio caprese gelato affogato macchiato cappuccino latte americano
cortado matcha chai smoothie cocktail sangria gazpacho tortilla quesadilla burrito taco
enchilada guacamole salsa chorizo jamon pintxo churro crembrulee bouillabaisse ratatouille
quiche crepe souffle foiegras escargot coqauvin cassoulet confit bechamel hollandaise
vinaigrette aioli tapenade bouillon consomme bisque pho padthai tomyum greencurry massaman
satay nasigoreng rendang kimchi bibimbap bulgogi tteokbokki gyoza udon soba miso teriyaki
yakitori tonkatsu okonomiyaki takoyaki onigiri bento dumpling wonton bao xiaolongbao chowmein
kungpao mapotofu pekingduck hotpot szechuan sichuan falafel hummus shawarma kebab doner gyros
tzatziki moussaka souvlaki baklava halloumi feta ouzo pierogi borscht goulash schnitzel braten
sauerbraten spaetzle knodel pretzel brezn weisswurst leberkaese obatzda schmankerl kaiserschmarrn
apfelstrudel sachertorte topfenstrudel palatschinken gulaschsuppe tafelspitz wienerschnitzel
frankfurter currywurst bratwurst sauerkraut kartoffelpuffer roesti raclette fondue waffle stroopwafel
bagel brunch streetfood foodtruck buffet amusebouche horsdoeuvre entree dessert digestif aperitif
prosecco champagne cava rioja chianti barolo pinotnoir chardonnay riesling gewurztraminer
gruenerveltliner dimsum yakisoba edamame misosoup tonkotsu shoyu shio miso shabu shabu
sukiyaki unagi unagi don chirashi donburi poke pokebowl acai acaibowl buddha bowl grainbowl
ceviche tiradito lomo saltado arepa empanada alfajor dulcedeleche mate yerba chimichurri
ceviche michelada michelada clamato michelada aguachile aguachile tostada elote esquites
halloumi saganaki moussaka pastitsio spanakopita tiropita dolmades dolma tabbouleh fattoush
manakish manoushe kibbeh kofta shakshuka shakshouka ful medames koshari falafel wrap shawarma plate
injera wat doro wat kitfo tibs berbere harissa merguez couscous tagine pastilla bastilla
jollof fufu egusi suya suya stick suya pepper soup pepper soup bobotie bunnychow bunny chow
butterchicken tikka masala korma vindaloo rogan josh saag paneer palak paneer naan roti paratha
samosa pakora bhaji dosa idli vada uttapam lassi chai masala chai cardamom chai
banhmi pho bo bun bo hue com tam broken rice spring roll summer roll fresh roll
padsee pad kee mao somtam larb gai tom yum tom kha kai massaman panang green curry
peking duck xiao long bao char siu bbq pork roast duck roast pork siu mai har gow
lobster roll clam chowder cioppino bouillabaisse fishandchips mushypeas mushy peas black pudding
full english breakfast fry up ulster fry welsh rarebit scotch egg scotch egg pork pie
steak tartare tartare carpaccio vitello tonnato vitello tonnato osso buco ossobuco saltimbocca
cacio e pepe cacio pepe amatriciana gricia puttanesca arrabbiata marinara pomodoro alfredo
carbonara alla vodka vodka sauce pink sauce pesto genovese pesto rosso nduja nduja spread
burrata stracciatella scamorza pecorino grana padano parmigiano reggiano parmigiano reggiano
gorgonzola taleggio fontina asiago mascarpone ricotta ricotta salata buffalo mozzarella
bufala burrata caprese insalata panzanella ribollita pappa al pomodoro ribollita ribollita soup`,

fillEs: `hola gracias porfavor buenosdias buenastardes buenasnoches siesta fiesta plaza calle
avenida barrio mercado museo iglesia catedral alcazar alhambra sagradafamilia parkguell rambla
retiro prado flamenco tapa bodega cerveceria vinoteca terraza mirador playa costa costadelsol
costabrava camino peregrino manana adios hastaluego denada salud ole torero corrida madrid
barcelona sevilla valencia granada toledo bilbao sansebastian malaga cordoba salamanca santiago
zaragoza murcia alicante ibiza mallorca menorca tenerife grancanaria casabatllo casamila guernica
goya velazquez picasso dali gaudi miro andalucia catalunya euskadi galicia asturias cantabria
extremadura castilla aragon navarra larioja balears canarias cadiz huelva jaen almeria leon
valladolid burgos avila segovia cuenca guadalajara tarragona lerida lleida gerona girona
huesca teruel castellon castello pamplona logrono vitoria gasteiz sansebastian donostia
vigo coruna la coruna ourense lugo pontevedra ferrol aviles gijon oviedo santander
torremolinos marbella fuengirola benidorm torrevieja cartagena albacete ciudadreal
ciudad real badajoz caceres merida trujillo caceres plasencia merida emerita augusta
ronda nerja frigiliana mijas pueblo blanco pueblos blancos white villages white village
sevilla triana macarena alameda alcazar sevilla giralda torre del oro torre oro
cordoba mezquita juderia patiocordobes patio cordobes feria abril feria sevilla semana santa
granada albaicin sacromonte generalife generalife gardens tapas route tapas route
sanfermin encierro running bulls pamplona camino frances camino primitivo camino norte
camino portugues camino ingles camino finisterre finisterre cape finisterre muxia
compostela cathedral botafumeiro botafumeiro swing pilgrim passport credencial
tapas crawl tapeo vermut vermouth hour vermut hour aperitivo hour aperitivo hour
bocadillo bocata montadito pincho pintxo pintxos route pintxos poteo chiquiteo
pa amb tomaquet pan con tomate escalivada escalivada romesco romesco sauce romesco
fabada fabada asturiana cocido cocido madrileno callos callos madrileños tripe stew
gazpacho salmorejo porra antequerana ajoblanco ajo blanco gazpacho manchego
tortilla espanola patatas bravas patatas bravas croquetas croquetas jamon jamon iberico
jamon serrano chorizo morcilla morcilla blood sausage blood sausage morcilla de burgos
queso manchego manchego cheese manchego wine ribera duero ribera del duero rioja alavesa
rioja alta rioja baja cava penedes penedes cava jerez sherry fino manzanilla oloroso
amontillado palo cortado pedro ximenez pedro ximenez sherry vinegar sherry vinegar
flamenco tablao tablao flamenco cante jondo cante jondo baile flamenco baile flamenco
sevillanas sevillanas dance fandango fandango bulerias bulerias solea solea siguiriyas`,

fillIt: `ciao buongiorno buonasera grazie prego scusi permesso arrivederci salve piazza campo ponte
basilica duomo campanile palazzo galleria fontana colosseo pantheon vaticano trastevere rialto
gondola vaporetto uffizi firenze venezia milano napoli torino bologna genova verona padova siena
pisa lucca ravenna assisi perugia orvieto sorrento salerno bari lecce matera catania palermo
taormina agrigento siracusa cefalu trani alberobello polignano ostuni gallipoli ristorante
trattoria osteria enoteca gelateria pasticceria caffe cornetto aperol spritz negroni bellini
limoncello grappa amaro digestivo antipasto primo secondo contorno dolce formaggio salumi toscana
umbria sicilia sardegna amalfi positano capri pompei vesuvio cinqueterre navigli lascala cenacolo
pontevecchio fontanaditrevi piazzanavona piazzasanmarco fororomano roma termini trastevere testaccio
prati vatican museums sistine chapel sistine michelangelo last judgement last judgement
st peter st peters square piazza san pietro castel santangelo castel sant angelo
trevi fountain spanish steps spanish steps piazza di spagna villa borghese villa borghese
trastevere janiculum janiculum hill janiculum hill campidoglio capitoline capitoline hill
forum romanum palatine hill palatine aventine hill aventine hill circus maximus circus maximus
caracalla baths caracalla baths appian way via appia catacombs catacombs san callisto
san sebastiano san sebastiano catacombs ostia antica ostia antica hadrians villa hadrian villa
tivoli villa deste villa d este hadrian villa adriana adriana villa adriana
florence duomo brunelleschi brunelleschi dome baptistery baptistery doors gates paradise
galleria dell accademia david michelangelo david ponte vecchio ponte vecchio oltrarno oltrarno
pitti palace boboli gardens boboli gardens san lorenzo san lorenzo market mercato centrale
venice san marco doges palace doge palace doges palace rialt bridge rialto bridge
grand canal grand canal burano murano murano glass torcello lace island lace island
verona arena juliet balcony juliet balcony romeo juliet casa di giulietta
milan duomo galleria vittorio galleria vittorio emanuele la scala teatro alla scala
last supper cenacolo vinciano last supper cenacolo vinciano navigli district navigli district
como lake como bellagio varenna menaggio lake garda sirmione malcesine riva del garda
dolomites cortina courmayeur courmayeur matterhorn cervino gran paradiso gran paradiso
etna volcano etna volcano stromboli volcano stromboli aeolian islands aeolian islands
lipari vulcano vulcano island panarea panarea island salina salina island
procida procida island ischia ischia island capri faraglioni faraglioni rocks blue grotto
grotta azzurra amalfi coast amalfi coast path gods path of the gods`,

fillFr: `bonjour merci aurevoir silvousplait bonsoir bonnenuit cafe bistro brasserie fromagerie
patisserie boulangerie fromage baguette croissant painauchocolat eclair macaron crepe galette
quiche ratatouille bouillabaisse cassoulet confit foiegras escargot steakfrites moulesfrites
croquemonsieur croquemadame soupealoignon coqauvin boeufbourguignon cremebrulee tartetatin
profiterole millefeuille eiffeltower louvre museedorsay notredame sacrecoeur montmartre
champselysees arcdetriomphe seine rivegauche rivedroite quartierlatin marais bastille versailles
fontainebleau chambord chenonceau loire provence cotedazur nice cannes marseille lyon bordeaux
toulouse nantes strasbourg lille rennes dijon avignon arles aixenprovence sainttropez monaco
montecarlo corse champagne bourgogne alsace normandie bretagne biarritz chamonix annecy
promenadedesanglais vieuxport operagarnier centrepompidou grandpalais petitpalais orangerie tuileries
luxembourggarden pantheon saintechapelle conciergerie iledecite perelachaise catacombes moulinrouge
foliesbergere hautecouture pretaporter boutique atelier parfum cognac armagnac calvados pastis
absinthe kirroyale aperitif digestif montsaintmichel saint malo saint malo corsica ajaccio
bastia bonifacio calvi porto vecchio porto vecchio calanques calanques cassis cassis calanques
luberon luberon villages gordes gordes roussillon roussillon ochre village ochre village
avignon palais des papes palais papes festival avignon festival avignon bridge pont avignon
pont d avignon chateauneuf du pape chateauneuf pape wine route wine route rhone valley
rhone valley beaune beaune burgundy burgundy wine route burgundy route des grands crus
route grands crus chablis chablis meursault meursault puligny montrachet puligny montrachet
chamonix mont blanc mont blanc aiguille du midi aiguille midi mer de glace mer de glace
annecy lake annecy old town annecy old town canals canals annecy canals annecy
strasbourg petite france petite france cathedral strasbourg cathedral strasbourg christmas market
christmas market colmar colmar alsace wine route alsace wine route riquewihr riquewihr
eguisheim eguisheim turckheim turckheim kaysersberg kaysersberg haut koenigsbourg haut koenigsbourg
reims reims cathedral champagne houses champagne houses epernay epernay avenue champagne
avenue champagne taittinger taittinger moet moet chandon veuve clicquot veuve clicquot
dom perignon dom perignon bordeaux saint emilion saint emilion medoc medoc chateau tour
chateau margaux chateau margaux chateau lafite chateau lafite chateau latour chateau latour`,

fillAt: `servus gruessgott baba pfiati leiwand hawara oida baucherl semmel kipferl topfen topfenstrudel
apfelstrudel milchrahmstrudel kaiserschmarrn palatschinken sachertorte esterhazytorte dobostorte
gugelhupf linzertorte mozartkugel mannerschnitten almdudler sturm heuriger buschenschank
gemischtersatz gruenerveltliner zweigelt blaufraenkisch sanktlaurent riesling wachau kremstal kamptal
thermenregion neusiedlersee burgenland steiermark kaernten tirol vorarlberg salzburg salzkammergut
hallstatt badischl sanktwolfgang mondsee wolfgangsee trautensee attersee hallstaettersee dachstein
grossglockner innsbruck graz linz klagenfurt bregenz eisenstadt stpoelten wien schoenbrunn belvedere
stephansdom hofburg prater naschmarkt schwedenplatz karlsplatz mariahilf landstrasse wieden josefstadt
alsergrund brigittenau floridsdorf donaustadt ottakring hernals waehring doebling meidling favoriten
simmering leopoldstadt moedling baden bei wien baden bei wien wiener neustadt wiener neustadt
krems an der donau krems donau melk abbey melk abbey duernstein duernstein wachau valley
wachau valley apricot apricot orchards apricot orchards marillenknodel marillenknodel apricot dumpling
goulash soup goulaschsuppe tafelspitz tafelspitz boiled beef boiled beef apple strudel apfelstrudel
sachertorte original sachertorte original esterhazy torte esterhazy torte linzer torte linzer torte
gugelhupf gugelhupf kaiserschmarrn kaiserschmarren kaiserschmarren shredded pancake shredded pancake
wiener schnitzel wiener schnitzel breaded veal breaded veal cordon bleu cordon bleu
backhendl backhendl fried chicken fried chicken potato salad erdaepfelsalat erdaepfelsalat
knödel knoedel bread dumpling bread dumpling speck speck bacon bacon speck dumpling speck dumpling
kaspressknödel kaspressknoedel cheese dumpling cheese dumpling liptauer liptauer spread liptauer spread
obatzda obatzda cheese spread cheese spread radler radler shandy shandy almdudler almdudler soda
sturm sturm young wine young wine heuriger heuriger wine tavern wine tavern buschenschank
buschenschank wine tavern wine tavern new wine new wine vintner vintner winzer winzer
zweigelt zweigelt blaufraenkisch blaufraenkisch gruener veltliner gruener veltliner riesling riesling
wachau riesling wachau riesling kamptal riesling kamptal riesling thermenregion thermenregion
steiermark steiermark styria styria kaernten kaernten carinthia carinthia kaerntner kasnudeln
kaerntner kasnudeln carinthian pasta carinthian pasta reindling reindling carinthian cake
carinthian cake nockberge nockberge nock mountains nock mountains grossglockner grossglockner high alpine
high alpine road grossglockner road grossglockner road edelweiss edelweiss alpine flower alpine flower`,

fillGebaeude: `dom kathedrale muenster basilika kirche kapelle kloster abtei stift schloss burg festung turm
rathaus palast museum galerie oper theater konzerthaus bibliothek universitaet bahnhof flughafen
hafen markthalle speicherstadt speicher kontorhaus rathausplatz marktplatz kirchenplatz schlosshof
burghof stadttor stadtturm glockenturm campanile minarett synagoge moschee pagode tempel arena
amphitheater kolosseum aquädukt bruecke viadukt tunnel unterfuehrung hochhaus wolkenkratzer skyline
panoramaaussicht belvedere orangerie gewaechshaus pavillon villa chalet huette berghuette gasthof
gasthaus herberge hostel hotel resort spa wellnesscenter fitnessstudio stadion sporthalle eishalle
schwimmbad therme sauna badehaus kurhaus casino spielbank discothek nightclub lounge bar pub
weinstube biergarten brauerei destillerie manufaktur fabrik werkstatt atelier kunstmuseum technikmuseum
naturkundemuseum volksmuseum landesmuseum stadtmuseum openairmuseum freilichtmuseum zoo botanischergarten
park garten schrebergarten allotment allotment garden allotment garden community garden community garden
observatorium planetarium sternwarte sternwarte lighthouse lighthouse leuchtturm leuchtturm windmill windmill
windmuehle windmuehle watermill watermill wassermuehle wassermuehle castle keep castle keep bergfried
bergfried donjon donjon moat moat burggraben burggraben drawbridge drawbridge zugbruecke zugbruecke
gatehouse gatehouse torhaus torhaus curtain wall curtain wall ringmauer ringmauer bailey bailey
vorburg vorburg keep keep bergfried bergfried great hall great hall rittersaal rittersaal
banquet hall banquet hall festsaal festsaal chapel chapel schlosskapelle schlosskapelle crypt crypt
gruft gruft mausoleum mausoleum mausoleum tomb tomb grabmal grabmal memorial memorial gedenkstaette
monument monument denkmal denkmal obelisk obelisk triumphal arch triumphal arch triumphbogen triumphbogen
column column siegessaeule siegessaeule statue statue standbild standbild fountain fountain brunnen brunnen
well well brunnen brunnen market hall market hall markthalle markthalle covered market covered market
covered market ueberdachter markt ueberdachter markt train station train station hauptbahnhof hauptbahnhof
central station central station central station regional station regional station regionalbahnhof regionalbahnhof
airport terminal airport terminal flughafen terminal flughafen terminal control tower control tower
control tower kontrollturm kontrollturm hangar hangar hangar cargo terminal cargo terminal cargo terminal`,

fillOrte: `altstadt neustadt innenstadt vorstadt vorort zentrum marktplatz rathausplatz kirchenplatz
schlossplatz bahnhofsplatz hafenquartier speicherstadt hafencity waterfront promenade uferboulevard kai
pier marina boardwalk steinweg fussgaengerzone einkaufsstrasse shoppingmeile flaniermeile ausgehviertel
nachtlebenviertel studentenviertel kuenstlerviertel museumsufer museuminsel regierungsviertel
diplomatenviertel finanzviertel bankenviertel messegelaende messeplatz olympiapark olympischesdorf
olympiastadion mairpark stadtpark volkspark tiergarten botanischergarten zoologischer wildpark
freizeitpark vergnuegungspark themenpark erlebnispark naturpark nationalpark biosphaerenreservat
weltkulturerbe unesco denkmal gedenkstaette mauergedenkstaette holocaustmahnmal kriegsdenkmal siegessaeule
brandenburger tor holstentor elbtower fernsehturm funkturm sendeturm aussichtsturm panormaturm
drehrestaurant skybar rooftopbar boulevard avenue boulevard grand boulevard grand boulevard main street
main street hauptstrasse hauptstrasse side street side street nebenstrasse nebenstrasse alley alley
gasse gasse lane lane weg weg path path pfad pfad square square platz platz roundabout roundabout
kreisverkehr kreisverkehr traffic circle traffic circle rotonda rotonda junction junction kreuzung
kreuzung intersection intersection kreuzung kreuzung crossroads crossroads scheideweg scheideweg fork fork
gabelung gabelung bridge approach bridge approach brueckenzugang brueckenzugang riverfront riverfront
flussufer flussufer lakeside lakeside seeufer seeufer seaside seaside strandpromenade strandpromenade
boardwalk boardwalk strandpromenade strandpromenade pier pier steg steg jetty jetty anlegestelle
anlegestelle harbor harbor hafen hafen port port seehafen seehafen marina marina yachthafen yachthafen
wharf wharf kai kai dock dock dock dock quay quay kai kai embankment embankment ufer ufer
esplanade esplanade promenade promenade boulevard boulevard esplanade esplanade waterfront district
waterfront district hafenviertel hafenviertel warehouse district warehouse district speicherviertel
speicherviertel creative quarter creative quarter kreativquartier kreativquartier design district
design district designviertel designviertel fashion district fashion district modeviertel modeviertel
jewelry quarter jewelry quarter goldschmiedeviertel goldschmiedeviertel antique quarter antique quarter
antiquitaetenviertel antiquitaetenviertel flea market quarter flea market quarter flohmarktviertel
flohmarktviertel night market night market nachtmarkt nachtmarkt christmas market christmas market
weihnachtsmarkt weihnachtsmarkt farmers market farmers market wochenmarkt wochenmarkt`,

fillStaedte: `berlin hamburg muenchen koeln frankfurt stuttgart duesseldorf dortmund essen leipzig bremen
dresden hannover nuernberg duisburg bochum wuppertal bielefeld bonn muenster karlsruhe mannheim augsburg
wiesbaden gelsenkirchen moenchengladbach braunschweig chemnitz kiel aachen halle magdeburg freiburg
krefeld luebeck oberhausen erfurt rostock mainz kassel hagen hamm saarbruecken potsdam ludwigshafen
oldenburg leverkusen osnabrueck heidelberg darmstadt solingen regensburg herne neuss reutlingen koblenz
siegen hildesheim salzgitter wuerzburg goettingen trier remscheid jena cottbus erlangen tuebingen konstanz
flensburg wismar stralsund greifswald schwerin landshut passau bamberg bayreuth coburg ingolstadt fuerth
ulm esslingen ludwigsburg heilbronn pforzheim rastatt offenbach hanau fulda marburg giessen limburg
wetzlar ravensburg friedrichshafen lindau kempten memmingen noerdlingen ansbach schwabach amberg weiden
hof paris london madrid barcelona roma milano napoli torino firenze venezia bologna genova verona
amsterdam bruxelles brussel wien zuerich genf bern basel luxemburg praha budapest warszawa krakow
gdansk wroclaw poznan stockholm goteborg malmo oslo bergen kopenhagen aarhus helsinki turku dublin
edinburgh glasgow lisboa porto athens thessaloniki istanbul ankara izmir dubrovnik split zagreb
ljubljana bratislava vilnius riga tallinn reykjavik valletta nicosia luxembourg city luxembourg city
monaco ville monaco ville san marino san marino andorra la vella andorra la vella
vaduz liechtenstein vaduz liechtenstein vaduz castle vaduz castle`,

fillFluesse: `rhein elbe donau main mosel neckar isar spree havel oder weichsel weser ems ruhr lippe
wupper sieg lahn fulda eder diemel leine aller oste saale unstrut weisseelster mulde schwarzeelster
peene warnow trave schwale stoer eider treene alster bille doveelbe suederlbe nordelbe neisse
lausitzerneisse glatzerneisse inn lech iller wertach ammer amper loisach mangfall alz salzach traun
enns mur drau wutach kinzig murg alb nagold enz kocher jagst rems fils aare reuss limmat thur saane
rhone doubs saone loire seine marne oise aisne somme meuse saar orne touques yonne loiret cher vienne
dordogne garonne lot tarn aveyron ardeche drome isere ill thur toess po danube duna dunaj dunav
dunarea volga dnepr dnipro don volga ural ob irtysh yenisei lena amur yangtze yellow river huang he
pearl river zhujiang mekong mekong river mekong delta ganges ganga yamuna indus brahmaputra irrawaddy
chao phraya red river song hong mekong sekong tonle sap tonle sap lake tonle sap mae nam chaophraya
nile blue nile white nile congo zambezi niger senegal orange limpopo okavango nile cataracts nile delta
mississippi missouri ohio columbia colorado rio grande rio bravo amazon amazon river amazon basin
orinoco parana paraguay uruguay madeira tapajos negro river negro river solimoes solimoes river
saint lawrence hudson delaware potomac susquehanna james river james river colorado river grand canyon
fraser river mackenzie river yukon river st lawrence seaway st lawrence seaway great lakes great lakes
`,

fillBerge: `zugspitze wetterstein karwendel watzmann hochkalter hocheisspitze dachstein grossglockner wildspitze
ortler marmolada matterhorn jungfrau eiger moench titlis pilatus rigi saentis glaernisch toedi
berninamassiv pizberina pizpalu pizmorteratsch montebianco montblanc monte rosa dentblanche weisshorn
breithorn castor pollux liskamm dom tasschorn alphubel allalinhorn lagginhorn weissmies nadelhorn
festigipfel strahlhorn rimpfischhorn grossvenediger grossohrenkopf hohenwartkopf ankoegel hochvogel
parseierspitze schesaplana panuelerspitze feldberg belchen schauinsland kandel blauen rothaar brocken
wurmberg achtermannshoehe oderturm fichtelberg auersberg keilberg klinovec snezka schneekoppe hohenbogen
arber rachel lusen dreisessel grosser arber kleiner arber everest k2 kangchenjunga lhotse makalu
cho oyu dhaulagiri manaslu nanga parbat annapurna gasherbrum broad peak gasherbrum ii shishapangma
aconcagua ojos del salado mont blanc monte rosa matterhorn weisshorn dent blanche grand combin
gran paradiso monte bianco cervino monte rosa massif monte rosa massif bernese alps bernese alps
berner oberland berner oberland jungfrau region jungfrau region eiger north face eiger north face
matterhorn zermatt matterhorn zermatt mont blanc chamonix mont blanc chamonix dolomites dolomites
tre cime tre cime di lavaredo tre cime di lavaredo civetta civetta marmolada marmolada
`,

fillNamen: `martin eva karl puck thorsten victoria findus finnus anna lukas jonas emma mia sophia leon
maxi max paul ben noah elias felix david julian tobias sebastian alexander michael thomas andreas
stefan christian daniel matthias markus peter hans johann johannes wolfgang franz josef maria theresia
elisabeth katharina christine sabine monika petra birgit heike andrea susanne nicole claudia tanja julia
laura sarah lisa jenny nina vanessa michelle jennifer jessica amanda ashley tiffany william james john
robert george charles henry edward richard elizabeth charlotte catherine margaret helen mary giuseppe
giovanni marco luca alessandro francesco antonio pierre jean louis francois marie claire sophie carlos
juan pedro miguel jose carmen lucia lars erik olaf bjorn ingrid freya astrid helga hans peter
heinrich friedrich wilhelm otto rudolf günther guenther helmut gerhard horst dieter klaus uwe ralf
jürgen juergen bernd manfred werner horst ingrid ursula helga gertrud hannelore monika ingeborg
brigitte karin renate susanne andrea petra birgit gabriele christine heike corinna anja silke
sandra melanie kathrin nadine jasmin jennifer jessica michelle vanessa nina sarah laura julia tanja
claudia nicole susanne andrea heike birgit petra monika christine katharina elisabeth theresia maria
josef franz wolfgang johannes johann hans peter markus matthias daniel christian stefan andreas thomas
michael alexander sebastian tobias julian david felix elias noah ben paul max leon mia emma sophia
`,

fillHistorisch: `mittelalter renaissance barock rokoko klassizismus biedermeier jugendstil artnouveau artdeco bauhaus
expressionismus reformation gegenreformation dreissigjaehrigerkrieg napoleonischekriege revolution1848 kaiserreich
weimarerrepublik drittesreich nachkriegszeit wirtschaftswunder kalterkrieg mauerfall wiedervereinigung hanse
hansestadt freistadt kurfuerstentum herzogtum koenigreich reichstag bundesrat bundeskanzler kaiser koenig
herzog kurfuerst burggraf reichsgraf freiherr ritter knappe zunft gilde handwerker kaufmann patrizier
burger stadtmauer stadtgraben bollwerk bastion zwinger burgfried bergfried palas rittersaal domkapitel
bistum erzbistum papst kardinal inkquisition kreuzzug wallfahrt reliquie heiligenschrein römisches reich
heiliges römisches reich kaiser krone kaiserkrone kronjuwelen kronjuwelen imperium imperium romanum
byzantinisches reich byzantinisches reich osmanisches reich osmanisches reich habsburg habsburg dynastie
habsburg dynastie bourbon bourbon dynastie bourbon dynastie romanov romanov dynastie romanov dynastie
plenum plenum senat senat forum forum agora agora akropolis akropolis parthenon parthenon kolosseum
kolosseum pantheon pantheon forum romanum forum romanum pompeji pompeji herculaneum herculaneum
vesuv ausbruch vesuv ausbruch karolingisch karolingisch ottonisch ottonisch salisch salisch staufisch
staufisch welfisch welfisch guelf guelf ghibelline ghibelline investiturstreit investiturstreit`,

fillAltertuemlich: `allhier allwo allda alldorten demnachst derenthalben derowegen derowyl derweilen derzeit deshalben
dessentwegen dieweilen eineweils einstweilen fürbass fürwahr garsehr garwol gehabter gestalt geruhen
gewahren hiedurch hiefür hienach hiezu hiedroben hinieden indessen innert inzwischen jeher jemals
jenachdem mithin mittlerweile nachmals neulich ohnedem ohnedies ohngeachtet ohnehin sonsten sodann sogleich
solchemnach solcherart solcherlei solchermaßen solchergestalt soviel sovielmals soweit sowie sowohl dergestalt
dermaßen obgleich obwohl obschon obzwar wiewohl wenngleich zumal zumalen zuvörderst zumeist allbereits
allenthalben allerorten allerseits fürbass fürwahr fürderhin fortan forthin hinfort hinfortan hernach
hernachmals hierauf hieraus hierbei hierdurch hierfür hiergegen hierher hierhin hierin hiermit hiernach
hierüber hierum hierunter hierzu hierzwischen demungeachtet desungeachtet nichtsdestoweniger nichtsdestotrotz
alldieweil sintemal weil demnach demgemäß demgemäss demzufolge demzufolge folglich folglich dementsprechend
dementsprechend insofern insofern als als dass als ob gleichsam gleichwohl gleichfalls gleichermaßen
gleichermaßen hingegen hingegen indes indes indessen indessen inzwischen inzwischen mittlerweile mittlerweile
`,

fillUmgang: `moin servus hallo tschuess tschüss ciao ade adee na klar doch ey alter ey digga krass geil
mega ultra super hammer bombig spitze klasse prima tipptopp top cool nice chillig relaxed easy peasy
kein ding kein problem passt schon is gut is klar alles klar alles gut naja mal sehen mal gucken
mal schauen irgendwie irgendwann irgendwo irgendwas irgendwer eh sowieso ohnehin sowas sowasvon voll total
echt wirklich richtig absolut komplett bisschen bissl a bisserl a weng a wenig halt eben mal kurz
schnell fix flott zack bumm peng knall schwuppdiwupp uff puh ui oi aha oho ach so hm mhm okay
alright alrighty jo ja nee nein nö doch dochmal komm schon lass mal check mal guck mal hör mal
hor mal sag mal weißt du weisst du verstehste verstehst du kapiert kapiersch kein plan keinen plan
null plan null bock kein bock null bock voll bock mega bock richtig bock null lust kein lust voll lust
null stress kein stress voll stress null schmerz kein schmerz voll schmerz null drama kein drama voll drama
null thema kein thema voll thema null sorge kein sorge voll sorge null problem kein problem voll problem
`,

fillDialekte: `moin moinmoin servus griassdi griassench pfiatdi pfiatenk pfiati baba adee ozapftis brezn nockerl
schmankerl obatzda weisswurst leberkaes dirndl trachtenhut lodenjanker platt düütsch plattdeutsch friesisch
kibbeling labskaus pfefferpotthast grünkohl pinkel schnaps steinhäger hamburger deern jung berlinerisch
ick det wat janz kiez späti dönerbude sächsisch nu gucke emol pfälzisch allez hopp schwäbisch gschickt
gscheid bairisch oachkatzlschwoaf österreichisch leiwand hawara oida schweizerdeutsch grüezi mercivilmal
walliser rätoromanisch norddeutsch süddeutsch westfalen rheinisch kölsch berlinern hamburgerplatt holsteinisch
mecklenburgisch pommersch schlesisch preussisch fränkisch oberfränkisch unterfränkisch oberbayerisch
niederbayerisch oberösterreichisch niederösterreichisch tirolerisch vorarlbergerisch kärntnerisch steirisch
burgenländisch wienerisch sächsisch sächsisch erzgebirgisch erzgebirgisch lausitzisch lausitzisch sorbisch
sorbisch wendisch wendisch pommersch pommersch low german low german platt plattdeutsch plattdeutsch
`,

};

for (const [name, text] of Object.entries(fills)) {
  const re = new RegExp(`const ${name} = words\\(\`[\\s\\S]*?\`\\);`);
  const replacement = `const ${name} = words(\`${text.trim()}\`);`;
  if (!re.test(src)) throw new Error('missing ' + name);
  src = src.replace(re, replacement);
}

// Add MIN_CAT constant after words function
if (!src.includes('const MIN_CAT')) {
  src = src.replace(
    "const words = (s) => [...new Set(s.split(/[\\s,]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 1))];",
    "const words = (s) => [...new Set(s.split(/[\\s,]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 1))];\n\nconst MIN_CAT = 330;"
  );
}

// Replace uniqPad calls to pass MIN_CAT
src = src.replace(/uniqPad\(([^)]+),\s*(en|de|es|it|fr)\)\]/g, 'uniqPad($1, $2, MIN_CAT)]');

fs.writeFileSync(path, src);
console.log('patched fills and MIN_CAT');
