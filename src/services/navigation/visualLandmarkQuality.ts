/**
 * Visuell verlässliche Outdoor-Landmarken für Turn-Cues.
 * Einfache Kreuzung: nur Ampel / Brücke / Tunnel / Treppe.
 * Briefkasten/Laden/Bank → nie.
 */

const TRAFFIC_LANDMARK_RE =
  /\b(ampel|verkehrslicht|brücke|bruecke|steg|tunnel|unterführung|unterfuehrung|treppe|stufen|fußgängerbrücke|fussgaengerbruecke)\b/iu;

export function isTrafficRelevantLandmark(
  label: string | null | undefined,
): boolean {
  return TRAFFIC_LANDMARK_RE.test(String(label || ''));
}

export function isWeakVisualLandmark(label: string | null | undefined): boolean {
  const t = String(label || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!t || t.length < 3) return true;
  if (t.length > 42) return true;
  if (
    /\b(briefkasten|mailbox|post\s*box|mülleimer|muelleimer|bank\b|sitzbank|automat|kiosk|flyer|werbetafel|plakat|heimatverein|ausstellung|infotafel|schau\s*kasten|laden|geschäft|geschaeft|café|cafe|bäck|baeck|shop|wartehäuschen|wartehaeuschen|wartehaus|haltestellenhäuschen|haltestellenhaeuschen|shelter|bushäuschen|bushaeuschen)\b/iu.test(
      t,
    ) ||
    /broschüre|broschuere|straßen\s+gestern|strassen\s+gestern/iu.test(t)
  ) {
    return true;
  }
  if (/^laden\s*\(/iu.test(t)) return true;
  if (/^(baum|tree)\b/iu.test(t) && !/[„"]/.test(label || '')) return true;
  // Einfache Cues: alles außer Verkehrs-Elementen verwerfen (Call-Site filtert).
  return false;
}

/** Straße/Allee/Gasse — besser als schwache Shop-Namen (auch Komposita). */
export function looksLikeStreetLandmark(label: string | null | undefined): boolean {
  return /(straße|strasse|str\.?|weg|allee|gasse|platz|ring|damm|chaussee|ufer)/iu.test(
    String(label || ''),
  );
}

/**
 * Landmarke: Ampel/Brücke/Tunnel/Treppe nur ≤5 m.
 * Einfache Kreuzung: nur diese Verkehrs-Elemente.
 * Komplexe Kreuzung: zusätzlich klare Named-Anker (keine Läden).
 */
export function shouldSpeakLandmarkOnTurn(opts: {
  landmark: string | null | undefined;
  isComplexTurn?: boolean;
  visualKind?: 'fork' | 'alley' | 'complex' | null;
  distanceM?: number | null;
}): boolean {
  const land = String(opts.landmark || '').trim();
  if (!land || isWeakVisualLandmark(land)) return false;
  const d = opts.distanceM;
  const within5 =
    d == null || !Number.isFinite(d) ? true : d <= 5;

  if (isTrafficRelevantLandmark(land)) {
    return within5;
  }

  // Einfach: keine Nicht-Verkehrs-Landmarken.
  // Auch „komplex“: kein Briefkasten, kein Wartehäuschen, kein Laden.
  if (!opts.isComplexTurn) return false;
  if (isWeakVisualLandmark(land)) return false;
  if (
    /\b(laden|shop|café|cafe|bäck|restaurant|imbiss|briefkasten|wartehäuschen|wartehaeuschen|wartehaus)\b/iu.test(
      land,
    )
  ) {
    return false;
  }
  // Straße allein ist keine Landmarke — die sagt der einfache Satz.
  if (looksLikeStreetLandmark(land) && !isTrafficRelevantLandmark(land)) {
    return false;
  }
  return true;
}
