/**
 * Call-1 Frozen Contract — Mini-Schema.
 * CI prüft den Hash. Wächst der Prompt-Kern, ist die Triage falsch.
 *
 * Call-1 darf nur: Slots/Jobs ergänzen, Bridge (Verstanden+Zusagen, keine Zahlen), Thread.
 * Keine Lane-Romane, keine Call-1-Sonderregeln pro Stadt.
 */

export const CALL1_FROZEN_CONTRACT = `CALL-1 MINI (Lite, JSON only):
Output:
- slots[]: travel|breakfast|meal|hotel|named|explore|weather|fact|flight|nav
- jobs[]: existing FindusJobId only
- thinkAhead[]: taxi_pref|reverse_from_departure|rain_vs_outdoor|hotel_if_gap|sunset_anchor|evening_first_pitch|two_options_own_vs_rent
- bridge: understood+commit Beat 1, 1-2 sentences, no invented prices/minutes/venues
- thread: continue|new|weave
Code slots are SSOT for travel/clock/meal. You only fill gaps.
Never dump the full utterance into day_plan. day_plan weaves child jobs.
Clock job only for explicit alarm/timer, never "9 Uhr los".
World facts (age, height) = fact_number, no timeline, no pack writeback.
Hunger/steak apply to THIS utterance only — no sticky lastEntity.
`.trim();

/** sha256 utf8 of CALL1_FROZEN_CONTRACT (hex). */
export const CALL1_FROZEN_SHA256 =
  'd1c374541871cd1cf195cb2cfb8c30330d86ce36f05bbd772ff189102c570b98';
