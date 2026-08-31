/** Google Directions `routes[].fare` — nichts schätzen. Kein RN. */

export function parseGoogleRouteFare(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data || data.status !== 'OK') return null;
  const routes = data.routes as
    | Array<{
        fare?: { text?: string; value?: number; currency?: string };
      }>
    | undefined;
  const fare = routes?.[0]?.fare;
  const text = String(fare?.text ?? '').trim();
  if (text) return text;
  if (typeof fare?.value === 'number' && Number.isFinite(fare.value) && fare.value > 0) {
    const n = fare.value;
    const amount = Number.isInteger(n)
      ? String(n)
      : n.toFixed(2).replace('.', ',');
    const cur =
      String(fare.currency || 'EUR').toUpperCase() === 'EUR' ? '€' : fare.currency;
    return `${amount} ${cur}`.trim();
  }
  return null;
}
