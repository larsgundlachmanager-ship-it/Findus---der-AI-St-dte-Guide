/** GPS/Popup können 0,0 oder leere Strings liefern — das ist kein Ziel. */
export function isUsableHomeMapNavCoord(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 0.2 && Math.abs(lng) < 0.2) return false;
  if (lat < -85 || lat > 85 || lng < -180 || lng > 180) return false;
  return true;
}
