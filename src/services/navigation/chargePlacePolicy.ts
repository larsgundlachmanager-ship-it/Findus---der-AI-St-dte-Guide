/**
 * Glaubwürdige Handy-Lade-Orte — reine Policy (kein RN/Google).
 * DE: „laden“ = Geschäft → Places-Junk (Heimat-/Touristenläden) nie akzeptieren.
 * Nie „besser als nichts“: Tourist-Info, Broschüre, Spielstadt, unnamed Steckdose.
 */

export type ChargeKind = 'powerbank' | 'device' | 'outlet' | 'cafe';

export type ChargePlaceLike = {
  name: string;
  types: string[];
  openNow?: boolean | null;
};

const POWERBANK_NAME_RE =
  /powerbank|power\s*bank|voozaa|cheetah|batterybar|rechargy|chargery|chargebar|candy\s*power|power\s*dot/i;
const DEVICE_NAME_RE =
  /device\s*charg|ladestation|charging\s*station|usb\s*charg|handy\s*ladestat|phone\s*charg|smartphone\s*charg/i;
const SOCKET_NAME_RE = /steckdose|socket|usb\s*outlet|power\s*outlet/i;

/**
 * Kein \\b vor heimat/broschüre — sonst rutscht „Heimatbroschüre“ durch.
 * Generisches OSM-Label „Ort mit Steckdose“ ist kein echter Spot.
 */
const CHARGE_JUNK_RE =
  /heimat|broschüre|broschuere|tourist[\s-]?info|touristeninformation|information\s*(büro|buero)|stadtmarketing|souvenir|geschenk|spielstadt|freizeitpark|\bmuseum\b|kirche|theater|\bkino\b|galerie|denkmal|friedhof|schule|kindergarten|^ort mit steckdose$/i;

const JUNK_TYPE_RE =
  /museum|tourist_attraction|tourist_information|place_of_worship|church|cemetery|school|movie_theater|art_gallery|amusement_park|aquarium|zoo|stadium|park|campground/i;

const CAFE_HOST_TYPE_RE =
  /^(cafe|bakery|restaurant|meal_takeaway|food|library|bar|book_store)$/i;

export function kindLabel(kind: ChargeKind): string {
  if (kind === 'powerbank') return 'Powerbank';
  if (kind === 'device') return 'Ladestation';
  if (kind === 'outlet') return 'Steckdose';
  return 'Café';
}

function blobOf(place: ChargePlaceLike): string {
  return `${place.name} ${place.types.join(' ')}`.toLowerCase();
}

export function looksLikeChargeJunk(place: ChargePlaceLike): boolean {
  const name = (place.name || '').trim();
  if (!name) return true;
  if (CHARGE_JUNK_RE.test(name)) return true;
  if (/^ort mit steckdose$/i.test(name)) return true;
  if (place.types.some((t) => JUNK_TYPE_RE.test(t))) {
    if (POWERBANK_NAME_RE.test(place.name) || DEVICE_NAME_RE.test(place.name)) {
      return false;
    }
    return true;
  }
  return false;
}

function hasPowerbankEvidence(place: ChargePlaceLike): boolean {
  const blob = blobOf(place);
  if (POWERBANK_NAME_RE.test(blob)) return true;
  if (/vending_machine|rental_machine|rental:powerbank|powerbank/.test(blob)) {
    return true;
  }
  if (place.types.includes('powerbank')) return true;
  return false;
}

function hasDeviceEvidence(place: ChargePlaceLike): boolean {
  const blob = blobOf(place);
  if (DEVICE_NAME_RE.test(blob)) return true;
  if (/device_charg|phone_charge/.test(blob)) return true;
  if (place.types.includes('phone_charge')) return true;
  return false;
}

function hasOutletEvidence(place: ChargePlaceLike): boolean {
  const blob = blobOf(place);
  if (SOCKET_NAME_RE.test(blob)) return true;
  if (place.types.includes('outlet_cafe')) return true;
  return false;
}

function isCafeHost(place: ChargePlaceLike): boolean {
  if (looksLikeChargeJunk(place)) return false;
  if (place.types.some((t) => CAFE_HOST_TYPE_RE.test(t))) return true;
  return /\b(café|cafe|kaffee|bäck|baeck|library|bibliothek)\b/i.test(place.name);
}

/**
 * Nur Orte mit glaubwürdiger Lade-Option. fromType = Suchkanal,
 * Label/Accept nur mit Evidenz (nie „Heimatladen“ als Powerbank).
 * Café/Steckdose nur wenn explizit offen — unbekannt/zu = raus.
 */
export function acceptChargePlace(
  place: ChargePlaceLike,
  fromType: string,
): ChargeKind | null {
  if (looksLikeChargeJunk(place)) return null;
  if (place.openNow === false) return null;

  if (fromType === 'powerbank') {
    return hasPowerbankEvidence(place) ? 'powerbank' : null;
  }
  if (fromType === 'phone_charge') {
    if (hasPowerbankEvidence(place)) return 'powerbank';
    if (hasDeviceEvidence(place)) return 'device';
    if (hasOutletEvidence(place) && isCafeHost(place) && place.openNow === true) {
      return 'outlet';
    }
    return null;
  }
  if (fromType === 'outlet_cafe') {
    if (place.openNow !== true) return null;
    if (hasOutletEvidence(place) && isCafeHost(place)) return 'outlet';
    if (place.types.includes('outlet_cafe') && isCafeHost(place)) {
      return 'outlet';
    }
    return null;
  }
  if (fromType === 'cafe') {
    if (place.openNow !== true) return null;
    return isCafeHost(place) ? 'cafe' : null;
  }
  return null;
}

export function kindSpeechHint(kind: ChargeKind): string {
  if (kind === 'powerbank') return 'Powerbank-Automat';
  if (kind === 'device') return 'Handy-Ladestation';
  if (kind === 'outlet') return 'belegte Steckdose';
  return 'Café — Steckdose oft da, nicht garantiert';
}

export function formatChargeBullet(opts: {
  kind: ChargeKind;
  name: string;
  distanceM: number;
}): string {
  const dist =
    opts.distanceM < 1000
      ? `${Math.round(opts.distanceM / 10) * 10} m`
      : `${(opts.distanceM / 1000).toFixed(1)} km`;
  if (opts.kind === 'cafe') {
    return `${opts.name} · Café · Steckdose oft · ${dist}`;
  }
  return `${kindLabel(opts.kind)} · ${opts.name} · ${dist}`;
}

export function isPhoneChargeIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\b(powerbank|power\s*bank|ladeautomat|ladestation)\b/iu.test(t) ||
    /\b(steckdose|usb[-\s]?laden|handy\s*laden|smartphone\s*laden)\b/iu.test(t) ||
    /\b(handyakku|akku\s*(leer|schwach|fast\s*leer|laden)|akku\s*(ist\s+)?(auf|bei)\s*\d{1,3}\s*(%|prozent))\b/iu.test(
      t,
    ) ||
    /\bakku\b.{0,48}(\d{1,3}\s*(%|prozent)|leer|schwach|laden|aufladen)/iu.test(
      t,
    ) ||
    /\b(café|cafe).{0,24}steckdose|steckdose.{0,24}(café|cafe)\b/iu.test(t) ||
    /\b(aufladen).{0,20}(handy|smartphone|akku)\b/iu.test(t) ||
    /\b(handy|smartphone|akku).{0,20}(aufladen|laden)\b/iu.test(t)
  );
}
