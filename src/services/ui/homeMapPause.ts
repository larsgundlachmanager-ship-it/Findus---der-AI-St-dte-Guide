/**
 * Overlays (Timeline, Orte, Settings) dürfen GL, GPS und Gesten nicht
 * einfrieren. Chrome-Dim bleibt getrennt (`setChromeDim`).
 *
 * Historisch: `true` stoppte Dead-Reckoning + Heading in der WebView.
 * Das ließ die Karte tot wirken (kein Pan, kein Puck). Immer `false`.
 */

export function homeMapShouldPause(): boolean {
  return false;
}
