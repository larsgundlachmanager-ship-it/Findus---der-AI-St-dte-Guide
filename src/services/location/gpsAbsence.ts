/**
 * Live-GPS fehlt — nicht Prisdorf als Stadt erfinden.
 * Nach 2 Fehlversuchen: Call-1 darf fragen, ob der User noch am letzten Ort ist.
 */

let failCount = 0;
let lastPlaceLabel: string | null = null;

export function noteLiveGpsOk(): void {
  failCount = 0;
}

export function noteLiveGpsFail(): void {
  failCount += 1;
}

export function liveGpsFailCount(): number {
  return failCount;
}

export function shouldHintGpsAbsence(): boolean {
  return failCount >= 2;
}

export function noteGpsAbsencePlaceLabel(label: string | null | undefined): void {
  const t = (label || '').trim();
  lastPlaceLabel = t ? t.slice(0, 80) : lastPlaceLabel;
}

export function gpsAbsenceLastPlaceLabel(): string | null {
  return lastPlaceLabel;
}
