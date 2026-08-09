/**
 * Task Splitter + Intent — zerschneidet Multi-Intents.
 * Wichtig: deutsche Flexionen (navigiere, erzählen, anziehen) — keine zu engen \b-Stämme.
 */

import type { AgentIntent, PipelineTask } from '../types';

const SPLIT_RE = /\s+(?:und|sowie|außerdem)\s+/i;

export function detectIntent(text: string): AgentIntent {
  const t = text.toLowerCase();

  // App-Hilfe / Selbsterklärung vor Notfall-„Hilfe“
  if (
    /\b(was kannst du|was kannst du alles|erkl[aä]r(?:e|t)?\s*(dich|die app|findus)?|wie (?:ände|funktioniert|geht|nutze)|anleitung|hilfe[- ]?(katalog|app|stimme|wecker|navigation|kalender|einstellung))\b/.test(
      t,
    ) ||
    (/\bhilfe\b/.test(t) &&
      /\b(stimme|wecker|app|findus|einstellung|kalender|navigation|mikrofon|ton)\b/.test(
        t,
      ))
  ) {
    return 'system';
  }

  if (
    /\b(arzt|apotheke|notfall|notruf|verletzt|übel|uebel|kotz|toilette|\bwc\b)/.test(
      t,
    ) ||
    (/\bhilfe\b/.test(t) &&
      !/\b(stimme|wecker|app|findus|einstellung|kalender)\b/.test(t))
  ) {
    return 'emergency';
  }

  // Kleidung / Wetter vor Mobility (sonst „fahren“-Kontext)
  if (
    /anzieh|kleidung|pulli|jacke|schal|sonnencreme|regenjacke/.test(t) ||
    /\b(wetter|regen|kalt|kühl|kuehl|warm|sonne|wind|grad)\b/.test(t)
  ) {
    return 'umwelt';
  }

  // Geschichte/Tiefe VOR Gastro — sonst kapert „Restaurant“ im Ortsnamen „Mehr Historie“
  if (
    /erzähl|erzaehl|geschichte|historie|mehr\s+zur\s+geschichte|mehr\s+zur\s+historie|bahnhof|denkmal|kirche|museum|was weißt|was weisst|was kannst du .* erzähl/.test(
      t,
    ) ||
    /\b(wer war|fun fact)\b/.test(t)
  ) {
    return 'knowledge';
  }

  // Erkunden / „wo noch hin“ → knowledge (kein Planungs-Engine)
  if (
    /\b(noch\s+erkunden|wo\s+kann\s+man\s+(noch\s+)?hin|wo\s+kann\s+ich\s+noch\s+hin|wo\s+geht.?s\s+noch\s+hin|was\s+kann\s+man\s+noch\s+(machen|sehen|unternehmen)|sehenswürdig|sightseeing|bummeln?)\b/i.test(
      t,
    ) &&
    !/\b(essen|hunger|restaurant|café|cafe|brunch|frühstück|fruehstueck|dinner)\b/i.test(
      t,
    )
  ) {
    return 'knowledge';
  }

  // Wanderweg / Fahrradweg vorschlagen → knowledge
  if (
    /\b(wander(?:weg|wege|ung|tour)?|lehrpfad|fahrradweg|radweg|radroute|radtour|fernradweg|veloroute)\b/i.test(
      t,
    ) ||
    (/\b(wandern|radeln)\b/i.test(t) &&
      /\b(wo|schön|schoen|empfehl|vorschlag|nähe|naehe|route)\b/i.test(t)) ||
    (/\b(\d+(?:[.,]\d+)?\s*km|(?:ein(?:e)?|zwei|drei|1|2|3)\s*(?:stunden?|std\.?|h)|halbe\s*stunde)\b/i.test(
      t,
    ) &&
      /\b(unterwegs|spazier\w*|wandern|radeln|raus|runde|tour|ausflug|luft)\b/i.test(
        t,
      ))
  ) {
    return 'knowledge';
  }

  // Ort wählen / einplanen → gastro wenn Essen, sonst knowledge
  if (
    /\b(wo kann ich|wo gibt es|wo gibts|wo frühstück|wo fruehstueck|wo essen|wo brunch)\b/.test(
      t,
    ) ||
    (/\b(frühstück|fruehstueck|brunch|abendessen|mittagessen)\b/.test(t) &&
      /\b(wo|suchen|vorschlag|planen|einplanen|option)\b/.test(t)) ||
    (/\b(planen|einplanen|tagesplan|timeline)\b/.test(t) &&
      /\b(frühstück|fruehstueck|essen|restaurant|sunset|sonnenuntergang)\b/.test(
        t,
      ))
  ) {
    return /\b(frühstück|fruehstueck|brunch|abendessen|mittagessen|essen|restaurant)\b/.test(
      t,
    )
      ? 'gastro'
      : 'knowledge';
  }

  // Langer Multi-Termin-Tag → knowledge (UI-Kalender, kein Engine)
  if (
    (/\b(termin|tennis|arbeit|schicht|flug|zug)\b/.test(t) &&
      /\b(\d{1,2}[:.]\d{2}|\d{1,2}\s*uhr)\b/.test(t) &&
      /\b(essen|einkauf|frühstück|fruehstueck|planen|danach|dann)\b/.test(t)) ||
    (/\b(heut(?:en)?\s+tag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(
      t,
    ) &&
      /\b(planen|einplanen|tagesplan)\b/.test(t)) ||
    (/\b(muss|unbedingt|auf\s+jeden\s+fall)\b/.test(t) &&
      /\b(einkaufen|termin)\b/.test(t) &&
      /\b(essen|frühstück|fruehstueck|danach)\b/.test(t))
  ) {
    return 'knowledge';
  }

  if (
    /restaurant|gasthof|hunger|hungrig|\bessen\b|döner|doener|pizza|café|cafe|trinken|durst|speisekarte|abendessen|mittagessen|frühstück|fruehstueck|imbiss|sushi|empfehl|burger|tisch\s+reserv|reservier/.test(
      t,
    ) ||
    (/wo kann ich (heute Abend |heute abend )?hingehen/.test(t) &&
      !/\b(noch\s+erkunden|sehenswürdig|sightseeing|bummel)\b/i.test(t)) ||
    /was essen|noch.*essen|irgendwo essen/.test(t) ||
    // Anrufen nur mit Gastro-Kontext — sonst nicht Hotels/Notdienste kapern
    (/\b(anrufen|telefonnummer)\b/.test(t) &&
      /\b(restaurant|burger|pizza|café|cafe|tisch|essen|wirt|gastro)\b/.test(t))
  ) {
    return 'gastro';
  }

  if (
    /navigier|bring mich|führ mich|fuehr mich|route zu|zum gold|goldschatz/.test(
      t,
    ) ||
    /\b(öpnv|oepnv|verspätung|verspaetung|kompass|taxi bestell)\b/.test(t) ||
    /\b(schnellster weg|weg nach|weg zum)\b/.test(t)
  ) {
    return 'mobility';
  }

  if (
    /\b(ganzen tag|tag planen|tagesplan|komplex|einplanen)\b/.test(t) ||
    (/\b(plan|vormittag|nachmittag|sonnenuntergang)\b/.test(t) &&
      /\b(heute|morgen|tag|route erstellen|was können wir|was koennen wir)\b/.test(
        t,
      ))
  ) {
    return 'knowledge';
  }

  // Live-Edits / Stopp an Navi|Plan anhängen / alles löschen
  if (
    /\b(lösch|loesch|entferne|streich|verschieb|hinzufüg|hinzufueg|ergänz|ergaenz)\b/.test(
      t,
    )
  ) {
    return 'knowledge';
  }
  if (
    /\b(über\s+den\s+haufen|ueber\s+den\s+haufen|plan\s+neu|alles\s+raus|komplette?n?\s+plan)\b/.test(
      t,
    )
  ) {
    return 'knowledge';
  }
  if (
    /\b(füge?\s+|fuege?\s+|pack\s+|mitnehmen|noch\s+mit)\b/.test(t) &&
    /\b(hinzu|navi|plan|route|timeline)\b/.test(t)
  ) {
    return 'mobility';
  }
  if (
    /danach\s+(?:noch\s+)?(?:zum|zur|nach)\s+\w+/.test(t) &&
    /\b(hinzu|mitnehmen|plan|navi|route)\b/.test(t)
  ) {
    return 'mobility';
  }
  if (
    /\b(fortbewegung|verkehrsmittel)\b/.test(t) ||
    (/\b(umstell|wechsel)\b/.test(t) &&
      /\b(fahrrad|zu\s*fu[ßs]|bus|bahn|öpnv|auto|taxi)\b/.test(t))
  ) {
    return 'knowledge';
  }

  if (
    /\b(hotel|zimmer|übernacht|uebernacht|ferienwohnung|unterkunft|bounce|ticket\s+buch)\b/.test(
      t,
    ) ||
    (/\bbuch(?:en|ung)?\b/.test(t) &&
      /\b(hotel|zimmer|übernacht|uebernacht|ferienwohnung)\b/.test(t))
  ) {
    return 'booking';
  }

  if (/\b(lautstärke|lautstaerke|sprache|einstellung|stimme)\b/.test(t)) {
    return 'system';
  }

  if (/\b(erinner|merkst du|gestern|damals)\b/.test(t)) {
    return 'memory';
  }

  if (/übersetz|uebersetz|translate/.test(t)) {
    return 'translation';
  }

  if (/erinnere mich|zahnbürste|zahnbuerste|geofence|weck|powernap|power\s*nap|nickerchen|timer\b/.test(t)) {
    return 'trigger';
  }

  if (/recherchier|turnier|wer spielt|tiefgehend|aktuell news/.test(t)) {
    return 'deep_research';
  }

  return 'unknown';
}

export function splitTasks(rewrittenText: string): PipelineTask[] {
  const parts = rewrittenText
    .split(SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);

  const units = parts.length > 0 ? parts : [rewrittenText.trim()];
  return units.map((raw, i) => {
    const intent = detectIntent(raw);
    return {
      id: `task_${i}_${intent}`,
      rawText: raw,
      rewrittenText: raw,
      intent,
      priority: intent === 'emergency' ? 0 : i + 1,
    };
  });
}

export function bridgingLineForIntent(intent: AgentIntent): string {
  // Notfall-Ack — Persönlichkeit, kein „ich guck nach“. Primär kommt bridging vom LLM.
  switch (intent) {
    case 'gastro':
      return 'Hunger gecheckt — ich leg Optionen vor.';
    case 'mobility':
      return 'Weg ist klar — ich nehm die Route.';
    case 'knowledge':
      return 'Spannende Frage.';
    case 'booking':
      return 'Unterkunft — ich leg dir was hin.';
    case 'emergency':
      return 'Sofort — ich such die nächste Hilfe.';
    case 'umwelt':
      return 'Cool, dass du noch rausgehst.';
    case 'deep_research':
      return 'Gute Frage — ich check das.';
    case 'smalltalk':
      return 'Haha, okay.';
    default:
      return 'Check ich.';
  }
}
