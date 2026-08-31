/**
 * Link/Partner-Tap: Yorro redet weiter, während die Seite aufgeht.
 * Nav/Telefon killen Speech weiterhin.
 */

const KEEP_TALKING_ON_TAP = new Set([
  'OPEN_URL',
  'BOOK_STAY22',
  'BOOK_UBER',
  'BOOK_CAR_RENTAL',
  'BOOK_BOUNCE_LUGGAGE',
  'BOOK_ESIM',
  'OPEN_GYG_WIDGET',
]);

export function shouldKeepTalkingOnAction(type: string | null | undefined): boolean {
  return Boolean(type && KEEP_TALKING_ON_TAP.has(type));
}
